import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { setup, startPractice, placePractice, now, eventId, order } from '../tests/helpers/practice.mjs';

const compiled = await build({ entryPoints: [new URL('../lib/practice/service.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
const { continueMatching } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const smoke = process.argv.includes('--smoke');
rmSync(new URL(`./results/${smoke?'smoke':'baseline'}.json`,import.meta.url), {force:true});
const sizes = smoke ? [10, 100] : [10, 100, 1000];
const warmups = smoke ? 1 : 5;
const repeats = smoke ? 3 : 30;
const quote = x => '"' + x.replaceAll('"', '""') + '"';
const scalar = (s, query) => Object.values(s.sql.prepare(query).get())[0];

// Clone logical table state, including acceptance rowids. Preparation is not timed.
// This is a warm, sequential in-memory SQLite experiment, not a D1 latency test.
function snapshot(sql) {
  return sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name}) => {
    const columns = sql.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name);
    const rows = sql.prepare(`SELECT rowid AS __row, * FROM ${quote(name)} ORDER BY rowid`).all();
    return { name, columns, rows };
  });
}
function restore(sql, tables) {
  sql.exec('PRAGMA foreign_keys=OFF; BEGIN');
  try {
    for (const {name} of tables) sql.exec(`DELETE FROM ${quote(name)}`);
    for (const {name, columns, rows} of tables) {
      const stmt = sql.prepare(`INSERT INTO ${quote(name)} (rowid,${columns.map(quote).join(',')}) VALUES (${Array(columns.length+1).fill('?').join(',')})`);
      for (const row of rows) stmt.run(row.__row, ...columns.map(c => row[c]));
    }
    sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
  finally { sql.exec('PRAGMA foreign_keys=ON'); }
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
}
function verify(s, n, fills, input, makerIds) {
  const matches = s.sql.prepare('SELECT * FROM practice_matches ORDER BY rowid').all();
  assert.equal(matches.length, fills);
  assert.equal(scalar(s, 'SELECT COALESCE(SUM(quantity),0) FROM practice_matches'), fills);
  assert.deepEqual(matches.map(m => m.maker_id), makerIds.slice(0, fills));
  for (const m of matches) {
    assert.equal(m.quantity, 1);
    assert.equal(m.maker_price, 60);
    const entries = s.sql.prepare('SELECT * FROM practice_match_entries WHERE match_id=?').all(m.id);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map(e => e.user_id)).size, 2);
    assert.equal(entries.reduce((a,e) => a+e.principal_units,0), 40000);
    assert.equal(entries.reduce((a,e) => a+e.fee_units,0), 100);
    for (const e of entries) assert.equal(e.reserved_debit_units, e.principal_units+e.fee_units+e.released_units);
  }
  assert.equal(scalar(s, 'SELECT COUNT(*) FROM practice_orders'), n+1);
  const incoming = s.sql.prepare('SELECT p.* FROM practice_order_progress p JOIN practice_orders o ON o.id=p.order_id WHERE o.client_id=?').get(input.clientOrderId);
  assert.equal(incoming.filled_quantity, fills);
  assert.equal(incoming.held_units, (input.intent.quantity-fills)*input.intent.limitPriceCents*401);
  assert.equal(scalar(s, 'SELECT SUM(filled_quantity) FROM practice_order_progress'), fills*2);
  for (const p of s.sql.prepare('SELECT o.*,p.* FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id').all()) {
    assert.equal(p.held_units, (p.quantity-p.filled_quantity)*p.price_cents*401);
    assert.ok(p.filled_quantity >= 0 && p.filled_quantity <= p.quantity);
  }
  for (const user of ['a','b']) {
    const cash = s.sql.prepare('SELECT * FROM practice_cash WHERE user_id=?').get(user);
    const total = s.sql.prepare('SELECT SUM(p.held_units) held, SUM(p.executed_principal_units+p.charged_fee_units) spent FROM practice_order_progress p JOIN practice_orders o ON o.id=p.order_id WHERE o.user_id=?').get(user);
    assert.equal(cash.reserved_units, total.held ?? 0);
    assert.equal(cash.spent_units, total.spent ?? 0);
    assert.equal(cash.available_units+cash.reserved_units+cash.spent_units, 40000000);
    assert.equal(cash.spent_units, fills * (user === 'a' ? 60 : 40) * 401);
  }
}
const summary = values => {
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length/2);
  return { median: sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2, p95: sorted[Math.ceil(sorted.length*0.95)-1], min: sorted[0], max: sorted.at(-1) };
};
const cases = [];
for (const n of sizes) for (const scenario of ['no-match','single-fill','eight-fills']) {
  const s = setup();
  try {
    await startPractice(s.db,s.a); await startPractice(s.db,s.b);
    const eligible = scenario === 'no-match' ? 0 : scenario === 'single-fill' ? 1 : 8;
    const makerIds = [];
    for (let i=0;i<n;i++) {
      const result = await placePractice(s.db,s.a,order({quantity:1,limitPriceCents:i<eligible?60:10}),now);
      if (i<eligible) makerIds.push(result.order.id);
    }
    assert.equal(scalar(s,'SELECT COUNT(*) FROM practice_orders'),n);
    assert.equal(scalar(s,'SELECT COUNT(*) FROM practice_matches'),0);
    const initial = snapshot(s.sql);
    const samples = [];
    for (let iteration=-warmups;iteration<repeats;iteration++) {
      restore(s.sql,initial);
      const input = order({outcome:'no',limitPriceCents:40,quantity:eligible || 1});
      const start = performance.now();
      const placed = await placePractice(s.db,s.b,input,now);
      const initialEnd = performance.now();
      let filled = placed.order.filled_quantity, continuations = 0;
      while (filled < eligible) {
        assert.ok(continuations < 8,'Continuation did not converge');
        const account = await continueMatching(s.db,s.b,{eventId});
        const next = account.orders.find(o => o.id===placed.order.id).filled_quantity;
        assert.ok(next > filled,'Continuation made no progress');
        filled = next; continuations++;
      }
      const end = performance.now();
      verify(s,n,eligible,input,makerIds);
      const sample = { initialMs:initialEnd-start, completionMs:end-start, fills:filled, initialFills:placed.order.filled_quantity, continuations, invariantsPassed:true };
      if (iteration>=0) samples.push(sample);
    }
    const item = { scenario, restingOrders:n, eligibleMakers:eligible, samples, initialMs:summary(samples.map(s=>s.initialMs)), completionMs:summary(samples.map(s=>s.completionMs)) };
    cases.push(item);
    console.log(`${scenario.padEnd(12)} n=${n} initial median=${item.initialMs.median.toFixed(3)}ms completion median=${item.completionMs.median.toFixed(3)}ms p95=${item.completionMs.p95.toFixed(3)}ms; checks passed`);
  } finally { s.sql.close(); }
}
let commit = process.env.GITHUB_SHA ?? null;
if (!commit) { try { commit=readFileSync(new URL('../.benchmark-source-sha',import.meta.url),'utf8').trim(); } catch { try {commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();} catch {} } }
const result = { generatedAt:new Date().toISOString(), mode:smoke?'smoke':'baseline', commit, benchmarkSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), environment:{node:process.version,sqlite:process.versions.sqlite,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length}, methodology:{warmups,repeats,sizes,database:'node:sqlite in-memory via existing test adapter',state:'logical state restored including rowids before each iteration; warm caches; sequential',timing:'service calls only; excludes setup, state restoration, input construction and postcondition assertions; includes continuation account reads',multiFill:'8 eligible makers held constant across book sizes; not a full-book sweep',p95:'nearest-rank; exploratory with 30 samples; no HTTP, network, D1 or concurrency'}, cases };
mkdirSync(new URL('./results/',import.meta.url),{recursive:true});
writeFileSync(new URL(`./results/${smoke?'smoke':'baseline'}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(`Saved benchmarks/results/${smoke?'smoke':'baseline'}.json`);
