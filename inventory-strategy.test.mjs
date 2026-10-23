import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, makePath, quotes, valuation, selectCandidate, pairedInterval } from '../experiments/inventory-strategy/model.mjs';

test('seeded paths replay exactly; terminal outcome and hidden reference are shared evaluator inputs', () => {
  for (const regime of CONFIG.regimes) {
    const a = makePath(regime, 100000), b = makePath(regime, 100000);
    assert.deepEqual(a, b);
    assert.notEqual(a.pathHash, makePath(regime, 100001).pathHash);
    assert.equal(a.flow.length, 60);
    assert.ok([0, 1].includes(a.terminalYes));
    assert.ok(a.flow.every(x => x.limit >= 1 && x.limit <= 99 && x.quantity >= 1));
    assert.equal(a.flow[0].probabilityCents, 50);
    assert.ok(regime !== 'informed-shift' || [35, 65].includes(a.finalProbabilityCents));
  }
});
test('quotes reduce the overweight-side bid, preserve symmetry and bound possible fills', () => {
  assert.deepEqual(quotes(8, 0, 0).map(q => q.price), [45, 45]);
  assert.deepEqual(quotes(8, 0, 0.5).map(q => q.price), [41, 49]);
  assert.deepEqual(quotes(0, 8, 0.5).map(q => q.price), [49, 41]);
  for (const k of [0, ...CONFIG.candidates]) for (let net = -30; net <= 30; net++) {
    const q = quotes(Math.max(0, net), Math.max(0, -net), k);
    assert.equal(q[0].price + q[1].price, 90);
    assert.ok(net + q[0].quantity <= 30);
    assert.ok(net - q[1].quantity >= -30);
    assert.ok(q.every(x => x.price >= 1 && x.price <= 99));
  }
  assert.equal(quotes(30, 0, 1)[0].quantity, 0);
});
test('valuation pays exactly one dollar per winning contract and deducts fees once', () => {
  const yes = valuation(10, 4, 6 * 40000, 400, 60, 1);
  const no = valuation(10, 4, 6 * 40000, 400, 60, 0);
  assert.ok(Math.abs(yes.terminalPnlUsd - 3.99) < 1e-10);
  assert.ok(Math.abs(no.terminalPnlUsd + 2.01) < 1e-10);
  assert.ok(Math.abs(yes.referencePnlUsd - (0.6 * yes.terminalPnlUsd + 0.4 * no.terminalPnlUsd)) < 1e-10);
  assert.equal(yes.worstOutcomePnlUsd, no.terminalPnlUsd);
  assert.equal(valuation(5, 5, 4 * 40000, 400, 35, 0).terminalPnlUsd, valuation(5, 5, 4 * 40000, 400, 65, 1).terminalPnlUsd);
});
test('candidate selection rejects evaluation data and penalizes inventory explicitly', () => {
  const rows = CONFIG.candidates.map((k, i) => ({ split: 'development', skewPerContract: k, referencePnlUsd: 1, meanAbsInventory: 10 - i }));
  assert.equal(selectCandidate(rows).selected, 1);
  assert.throws(() => selectCandidate([...rows, { ...rows[0], split: 'evaluation' }]));
  assert.throws(() => selectCandidate(rows.slice(1)));
});
test('paired bootstrap resamples episode differences, preserving zero and constant effects', () => {
  assert.deepEqual(pairedInterval([0, 0, 0]), { mean: 0, low: 0, high: 0 });
  assert.deepEqual(pairedInterval([2, 2, 2]), { mean: 2, low: 2, high: 2 });
  assert.deepEqual(pairedInterval([-2, 1, 3]), pairedInterval([-2, 1, 3]));
});
