import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateOrder } from "../lib/domain/order.ts";
import { POST as placeOrder } from "../app/api/orders/route.ts";
test("100 contracts at 60 cents conserve the binary payoff", () => {
  const q = estimateOrder(60, 100);
  assert.equal(q.principalCents, 6000);
  assert.equal(q.payoutCents, 10000);
  assert.equal(q.grossProfitCents, 4000);
  assert.equal(q.principalCents + q.grossProfitCents, q.payoutCents);
});
test("invalid financial inputs are rejected", () => {
  for (const price of [0, 100, -1, 1.5, NaN, Infinity])
    assert.throws(() => estimateOrder(price, 10));
  for (const quantity of [0, -1, 1.5, 10001, NaN, Infinity])
    assert.throws(() => estimateOrder(60, quantity));
});
test("all allowed prices calculate integer money within supported sizes", () => {
  for (let p = 1; p < 100; p++)
    for (const n of [1, 10, 999, 10000]) {
      const q = estimateOrder(p, n);
      assert.ok(Number.isSafeInteger(q.principalCents));
      assert.equal(q.payoutCents, n * 100);
      assert.equal(q.grossProfitCents + q.principalCents, q.payoutCents);
    }
});
test("live order endpoint always fails closed without executing", async () => {
  const response = await placeOrder();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "LIVE_TRADING_UNAVAILABLE");
});

test("0.25% fee applies to contract cost and totals include the fee", () => {
  const q = estimateOrder(50, 200);
  assert.equal(q.principalCents, 10000);
  assert.equal(q.feeCents, 25);
  assert.equal(q.totalCents, 10025);
  assert.equal(q.netProfitCents, 9975);
  assert.equal(q.feeRateBps, 25);
});
test("per-contract fee retains sub-cent amounts without per-order rounding", () => {
  assert.equal(estimateOrder(1, 199).feeCents, 0.4975);
  assert.equal(estimateOrder(1, 200).feeCents, 0.5);
  assert.equal(estimateOrder(1, 600).feeCents, 1.5);
  const max = estimateOrder(99, 10000);
  assert.equal(max.feeCents, 2475);
  assert.equal(max.totalCents + max.netProfitCents, max.payoutCents);
});
