import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setup, startPractice, placePractice, cancelPractice, practiceAccount, now, order } from '../../tests/helpers/practice.mjs';
import { CONFIG, makePath, quotes, valuation, selectCandidate, pairedInterval, mean, hash } from './model.mjs';

const smoke = process.argv.includes('--smoke');
const out = new URL(smoke ? './smoke-results/' : './results/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const name of ['results.json', 'episodes.csv', 'paths.json', 'trajectories.csv', 'selection.json', 'report.md', 'inventory.svg']) rmSync(new URL(name, out), { force: true });
const counts = smoke ? { development: 1, evaluation: 2 } : { development: CONFIG.developmentSeeds, evaluation: CONFIG.evaluationSeeds };
const rows = [], paths = [], trajectories = [];
const csv = data => {
  const columns = Object.keys(data[0]);
  const cell = x => JSON.stringify(x ?? '');
  return columns.join(',') + '\n' + data.map(r => columns.map(c => cell(r[c])).join(',')).join('\n') + '\n';
};
const holdingsSql = `SELECT o.outcome,COALESCE(SUM(m.quantity),0) quantity,COALESCE(SUM(x.principal_units),0) principal,COALESCE(SUM(x.fee_units),0) fee
 FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=? GROUP BY o.outcome`;
function snapshot(s, userId) {
  const positions = s.sql.prepare(holdingsSql).all(userId);
  return { yes: positions.find(p => p.outcome === 'yes')?.quantity ?? 0,
    no: positions.find(p => p.outcome === 'no')?.quantity ?? 0,
    principal: positions.reduce((n, p) => n + p.principal, 0), fee: positions.reduce((n, p) => n + p.fee, 0) };
}
async function cancelRemaining(s, actor, id, clock) {
  const p = s.sql.prepare('SELECT o.status,o.quantity,p.filled_quantity FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE o.id=?').get(id);
  if (p.status === 'open' && p.filled_quantity < p.quantity) await cancelPractice(s.db, actor, { orderId: id }, clock);
}
function verifyLedger(s) {
  for (const actor of [s.a, s.b]) {
    const state = snapshot(s, actor.userId);
    const cash = s.sql.prepare('SELECT * FROM practice_cash WHERE user_id=?').get(actor.userId);
    assert.equal(cash.reserved_units, 0);
    assert.equal(cash.spent_units, state.principal + state.fee);
    assert.equal(cash.available_units + cash.reserved_units + cash.spent_units, 40000000);
    assert.ok(cash.available_units >= 0);
  }
}
async function episode(path, split, k) {
  const s = setup(), history = [];
  const policy = k === 0 ? 'fixed' : 'inventory';
  try {
    await startPractice(s.db, s.a); await startPractice(s.db, s.b);
    let state = snapshot(s, 'a'), quoted = 0, unavailableSides = 0;
    for (const step of path.flow) {
      const clock = now + step.t * 1000, posted = [];
      // Quote before reading this step's incoming order. Only prior holdings
      // and the frozen parameter are inputs to quotes().
      const quote = quotes(state.yes, state.no, k);
      for (const q of quote) {
        if (!q.quantity) { unavailableSides++; continue; }
        const placed = await placePractice(s.db, s.a, order({ outcome: q.outcome, limitPriceCents: q.price, quantity: q.quantity }), clock);
        posted.push(placed.order.id); quoted += q.quantity;
      }
      const incoming = await placePractice(s.db, s.b, order({ outcome: step.outcome, limitPriceCents: step.limit, quantity: step.quantity }), clock);
      const opposite = quote.find(q => q.outcome !== step.outcome);
      const expectedFill = opposite.price + step.limit >= 100 ? Math.min(opposite.quantity, step.quantity) : 0;
      assert.equal(incoming.order.filled_quantity, expectedFill);
      const next = snapshot(s, 'a');
      assert.equal(next.yes + next.no - state.yes - state.no, expectedFill);
      assert.equal(next.principal - state.principal, expectedFill * opposite.price * 400);
      assert.equal(next.fee - state.fee, expectedFill * opposite.price);
      state = next;
      await cancelRemaining(s, s.b, incoming.order.id, clock);
      for (const id of posted) await cancelRemaining(s, s.a, id, clock);
      assert.ok(Math.abs(state.yes - state.no) <= CONFIG.maxAbsInventory);
      verifyLedger(s);
      history.push({ split, regime: path.regime, seed: path.seed, policy, skewPerContract: k, t: step.t,
        yesBid: quote[0].price, noBid: quote[1].price, yesQuantity: state.yes, noQuantity: state.no,
        netInventory: state.yes - state.no, filled: expectedFill,
        referencePnlUsd: valuation(state.yes, state.no, state.principal, state.fee, step.probabilityCents, path.terminalYes).referencePnlUsd });
    }
    for (const actor of [s.a, s.b]) {
      const account = await practiceAccount(s.db, actor, 0, now);
      assert.ok(account.positionsReconciled);
      assert.equal(account.positionTotals.quantity, state.yes + state.no);
    }
    const total = s.sql.prepare('SELECT SUM(quantity) q FROM practice_matches').get().q ?? 0;
    assert.equal(total, state.yes + state.no);
    const entries = s.sql.prepare('SELECT SUM(principal_units) p,SUM(fee_units) f FROM practice_match_entries').get();
    assert.equal(entries.p ?? 0, total * 40000);
    assert.equal(entries.f ?? 0, total * 100);
    const values = valuation(state.yes, state.no, state.principal, state.fee, path.finalProbabilityCents, path.terminalYes);
    const offered = path.flow.reduce((n, x) => n + x.quantity, 0);
    const r = { split, regime: path.regime, seed: path.seed, pathHash: path.pathHash, policy, skewPerContract: k,
      terminalYes: path.terminalYes, finalProbabilityCents: path.finalProbabilityCents,
      yesQuantity: state.yes, noQuantity: state.no, filled: total, offered, fillRate: total / offered,
      quotedQuantity: quoted, unavailableSides, finalInventory: state.yes - state.no,
      meanAbsInventory: mean(history.map(h => Math.abs(h.netInventory))),
      maxAbsInventory: Math.max(...history.map(h => Math.abs(h.netInventory))),
      principalUsd: state.principal / 40000, feeUsd: state.fee / 40000,
      endingAvailableUsd: 1000 - (state.principal + state.fee) / 40000, ...values,
      terminalPnlAt0bps: values.terminalPnlUsd + state.fee / 40000,
      terminalPnlAt50bps: values.terminalPnlUsd - state.fee / 40000, checksPassed: true };
    if (split === 'evaluation') trajectories.push(...history);
    return r;
  } finally { s.sql.close(); }
}

for (const split of ['development', 'evaluation']) {
  // Evaluation paths are generated only after the development choice is saved.
  const selected = split === 'evaluation' ? JSON.parse(readFileSync(new URL('selection.json', out))).selected : null;
  for (let regimeIndex = 0; regimeIndex < CONFIG.regimes.length; regimeIndex++) {
    const regime = CONFIG.regimes[regimeIndex];
    for (let i = 0; i < counts[split]; i++) {
      const seed = (split === 'development' ? 10000 : 100000) + regimeIndex * 1000 + i;
      const path = makePath(regime, seed); paths.push({ split, ...path });
      for (const k of split === 'development' ? [0, ...CONFIG.candidates] : [0, selected]) rows.push(await episode(path, split, k));
    }
    console.log(`${split}: ${regime} finished; ${counts[split]} shared paths; all accounting checks passed`);
  }
  if (split === 'development') {
    const selection = { ...selectCandidate(rows), configHash: hash(CONFIG),
      rule: 'Mean terminal reference-value P&L minus 0.02 USD times time-average absolute inventory; rank inventory candidates on development seeds only; ties choose smaller skew.' };
    writeFileSync(new URL('selection.json', out), JSON.stringify(selection, null, 2) + '\n');
    console.log('Frozen selection:', selection.selected);
  }
}

const selection = JSON.parse(readFileSync(new URL('selection.json', out)));
const summary = CONFIG.regimes.map(regime => {
  const base = rows.filter(r => r.split === 'evaluation' && r.regime === regime && r.policy === 'fixed');
  const comparison = rows.filter(r => r.split === 'evaluation' && r.regime === regime && r.policy === 'inventory');
  const metrics = ['terminalPnlUsd', 'referencePnlUsd', 'meanAbsInventory', 'maxAbsInventory', 'fillRate', 'feeUsd', 'worstOutcomePnlUsd'];
  const result = { regime, pairedPaths: base.length, metrics: {} };
  for (const metric of metrics) {
    const differences = base.map((b, i) => {
      const c = comparison[i]; assert.equal(b.pathHash, c.pathHash); assert.equal(b.terminalYes, c.terminalYes);
      return c[metric] - b[metric];
    });
    result.metrics[metric] = { fixed: mean(base.map(r => r[metric])), inventory: mean(comparison.map(r => r[metric])), difference: pairedInterval(differences) };
  }
  return result;
});
let commit = process.env.GITHUB_SHA;
if (!commit) { try { commit = readFileSync(new URL('../../.experiment-source-sha', import.meta.url), 'utf8').trim(); } catch { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } }
const sourceHashes = {};
for (const path of ['./model.mjs', './run.mjs', '../../lib/practice/matching.ts', '../../lib/practice/service.ts', '../../tests/helpers/practice.mjs']) sourceHashes[path] = createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const result = { generatedAt: new Date().toISOString(), commit, smoke, config: CONFIG, counts, sourceHashes,
  environment: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
  selection, summary, episodes: rows };
writeFileSync(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n');
writeFileSync(new URL('paths.json', out), JSON.stringify(paths, null, 2) + '\n');
writeFileSync(new URL('episodes.csv', out), csv(rows));
writeFileSync(new URL('trajectories.csv', out), csv(trajectories));
const f = x => x.toFixed(3);
const lines = ['# Two-sided contract buying: inventory strategy comparison', '',
  `Source commit: ${commit}. Mode: ${smoke ? 'SMOKE ONLY' : 'full'}. Node ${process.version}; SQLite ${process.versions.sqlite}.`, '',
  `Selected skew: ${selection.selected} cents per net contract using development paths only.`,
  `${rows.length} episodes; ${paths.filter(p => p.split === 'evaluation').length} held-out paired paths; ${CONFIG.steps} arrivals per episode. All execution and accounting assertions passed.`, '',
  '## Held-out evaluation', '',
  'P&L is an offline valuation of accumulated contracts, not an application settlement transaction. Fixed and inventory policies share each complete order path and terminal outcome. All amounts are virtual USD.', '',
  '| Regime | Policy | Terminal P&L | Reference P&L | Mean absolute inventory | Fill rate | Fees |',
  '|---|---|---:|---:|---:|---:|---:|'];
for (const s of summary) for (const policy of ['fixed', 'inventory']) lines.push(`| ${s.regime} | ${policy} | ${f(s.metrics.terminalPnlUsd[policy])} | ${f(s.metrics.referencePnlUsd[policy])} | ${f(s.metrics.meanAbsInventory[policy])} | ${(s.metrics.fillRate[policy] * 100).toFixed(1)}% | ${f(s.metrics.feeUsd[policy])} |`);
lines.push('', '## Paired differences: inventory minus fixed', '', '95% percentile bootstrap intervals resample whole paired episodes within each regime. They describe this synthetic generator with the selected parameter held fixed; individual orders are not treated as independent observations.', '',
  '| Regime | Metric | Mean difference | 95% interval |', '|---|---|---:|---|');
for (const s of summary) for (const metric of ['terminalPnlUsd', 'referencePnlUsd', 'meanAbsInventory', 'fillRate']) {
  const d = s.metrics[metric].difference;
  lines.push(`| ${s.regime} | ${metric} | ${f(d.mean)} | [${f(d.low)}, ${f(d.high)}] |`);
}
lines.push('', '## Development selection', '', '| Skew | Mean reference P&L | Mean absolute inventory | Selection score |', '|---:|---:|---:|---:|');
for (const r of selection.ranking) lines.push(`| ${r.skewPerContract} | ${f(r.referencePnlUsd)} | ${f(r.meanAbsInventory)} | ${f(r.score)} |`);
lines.push('', '## Reading the evidence', '',
  '- Lower inventory is beneficial for the exposure objective; compare it with changes in fill rate, reference P&L and terminal P&L.',
  '- Terminal P&L uses one Bernoulli event outcome per path. Reference P&L uses the generator’s common final probability and reduces terminal outcome noise; neither probability nor outcome is supplied to the policy.',
  '- The informed-shift regime stresses stale fixed-value quotes after a hidden probability change. Inventory adjustment alone is not a probability forecasting model.',
  '- Fee sensitivity at 0/25/50 bps in episodes.csv revalues the same fills. Orders are executed by the actual service at its 25 bps fee.',
  '- This is buying complementary binary contracts; holdings accumulate without resale or collateral recycling. Quote cancellation has no latency or cost in the simulation.',
  '- The 16 evaluation paths per regime are a small synthetic sample. Intervals are conditional on this generator and selection; they do not establish real-market profitability.', '',
  '![Inventory paths for the first preselected evaluation seed in each regime](inventory.svg)', '');
writeFileSync(new URL('report.md', out), lines.join('\n'));
// Display the first evaluation seed by rule, rather than selecting a favorable path.
const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="960" height="660" viewBox="0 0 960 660"><rect width="960" height="660" fill="white"/><g font-family="sans-serif" font-size="13" fill="#182632">', '<text x="40" y="25" font-size="18">Net YES − NO holdings: first evaluation seed per regime</text><text x="40" y="47">Blue: fixed quotes · Orange: inventory-adjusted quotes · Holdings persist after quote cancellation</text>'];
CONFIG.regimes.forEach((regime, index) => {
  const y = 85 + index * 190, seed = 100000 + index * 1000;
  svg.push(`<text x="40" y="${y}">${regime} · seed ${seed}</text>`);
  for (const n of [-30, 0, 30]) { const yy = y + 90 - n * 2; svg.push(`<path d="M70 ${yy}H920" stroke="#dce2e7"/><text x="38" y="${yy + 4}">${n}</text>`); }
  for (const [policy, color] of [['fixed', '#2467bd'], ['inventory', '#ca6216']]) {
    const data = trajectories.filter(r => r.regime === regime && r.seed === seed && r.policy === policy);
    const points = data.map(r => `${70 + r.t / (CONFIG.steps - 1) * 850},${y + 90 - r.netInventory * 2}`).join(' ');
    svg.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`);
  }
  svg.push(`<text x="70" y="${y + 172}">Arrival 1</text><text x="860" y="${y + 172}">Arrival ${CONFIG.steps}</text>`);
});
svg.push('</g></svg>'); writeFileSync(new URL('inventory.svg', out), svg.join('\n'));
console.log(`Saved report, raw paths, episode metrics and trajectories. ${rows.length} episodes passed.`);
