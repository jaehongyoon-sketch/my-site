import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  practiceAccount,
  cancelPractice,
  now,
  eventId,
  order,
} from "./helpers/practice.mjs";
const b = await build({
  entryPoints: [new URL("../lib/practice/market.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { readMarket, readLastPrices } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
const event = {
  id: eventId,
  revision: 1,
  status: "published",
  closesAt: new Date(now + 86400000).toISOString(),
};
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
async function pair(s, yesPrice, quantity = 2, noMaker = false) {
  await placePractice(
    s.db,
    s.a,
    order({
      outcome: noMaker ? "no" : "yes",
      limitPriceCents: noMaker ? 100 - yesPrice : yesPrice,
      quantity,
    }),
    now,
  );
  await placePractice(
    s.db,
    s.b,
    order({
      outcome: noMaker ? "yes" : "no",
      limitPriceCents: noMaker ? yesPrice : 100 - yesPrice,
      quantity,
    }),
    now,
  );
}
test("empty and resting orders do not invent a price; cancellation removes depth", async () => {
  const s = await funded();
  const before = await readMarket(s.db, event, now);
  assert.equal(before.lastYesCents, null);
  assert.deepEqual(before.trades, []);
  const o = await placePractice(s.db, s.a, order({ quantity: 7 }), now);
  let m = await readMarket(s.db, event, now);
  assert.equal(m.lastYesCents, null);
  assert.deepEqual(m.bids, [{ outcome: "yes", price: 60, quantity: 7 }]);
  await cancelPractice(s.db, s.a, { orderId: o.order.id }, now);
  m = await readMarket(s.db, event, now);
  assert.deepEqual(m.bids, []);
});
test("YES and NO maker fills yield complementary prices, stable ordering, and counted-once volume", async () => {
  const s = await funded();
  await pair(s, 60);
  await pair(s, 35, 3, true);
  const m = await readMarket(s.db, event, now);
  assert.equal(m.lastYesCents, 35);
  assert.equal(m.previousYesCents, 60);
  assert.equal(m.volume, 5);
  assert.deepEqual(
    m.trades.map((t) => t.yesCents),
    [60, 35],
  );
  assert.equal(
    (await readLastPrices(s.db, [eventId, eventId])).get(eventId),
    35,
  );
  const a = await practiceAccount(s.db, s.a);
  assert.equal(
    a.positions.find((p) => p.outcome === "yes").marketValueUnits,
    2 * 35 * 400,
  );
  assert.equal(
    a.positions.find((p) => p.outcome === "no").marketValueUnits,
    3 * 65 * 400,
  );
  assert.equal(a.positionTotals.marketValueUnits, 265 * 400);
  assert.equal(
    a.positions.find((p) => p.outcome === "yes").unrealizedPnlUnits,
    2 * 35 * 400 - 2 * 60 * 400 - 120,
  );
  assert.ok(a.positionsReconciled);
});
test("partial fills publish only executed quantity and retain remaining depth", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 5 }), now);
  await placePractice(
    s.db,
    s.b,
    order({ outcome: "no", quantity: 2, limitPriceCents: 45 }),
    now,
  );
  const m = await readMarket(s.db, event, now);
  assert.equal(m.lastYesCents, 60);
  assert.equal(m.volume, 2);
  assert.deepEqual(m.bids, [{ outcome: "yes", price: 60, quantity: 3 }]);
});
test("self orders do not generate prices; paused, expired and restricted orders do not advertise executable depth", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await placePractice(
    s.db,
    s.a,
    order({ outcome: "no", quantity: 2, limitPriceCents: 40 }),
    now,
  );
  assert.equal((await readMarket(s.db, event, now)).lastYesCents, null);
  assert.deepEqual((await readMarket(s.db, event, now + 86400001)).bids, []);
  s.sql.prepare("UPDATE app_users SET status='suspended' WHERE id='a'").run();
  assert.deepEqual((await readMarket(s.db, event, now)).bids, []);
});
test("failed atomic match never creates a chart tick or valuation", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order(), now);
  s.injectMatch();
  await assert.rejects(() =>
    placePractice(
      s.db,
      s.b,
      order({ outcome: "no", limitPriceCents: 40 }),
      now,
    ),
  );
  assert.equal((await readMarket(s.db, event, now)).lastYesCents, null);
  assert.equal(
    (await practiceAccount(s.db, s.a)).positionTotals.marketValueUnits,
    0,
  );
});
