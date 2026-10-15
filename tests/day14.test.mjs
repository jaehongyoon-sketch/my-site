import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  practiceAccount,
  now,
  eventId,
  order,
} from "./helpers/practice.mjs";
const bundle = await build({
  entryPoints: ["lib/practice/sells.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { reserveSell, cancelSell } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const sell = (extra = {}) => order({ side: "sell", quantity: 2, ...extra });
async function held() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  await placePractice(s.db, s.a, order({ quantity: 5 }), now);
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 5 }), now);
  return s;
}
test("sell reserves only holdings and never moves cash or records a fill", async () => {
  const s = await held(),
    before = await practiceAccount(s.db, s.a),
    request = sell();
  const receipt = await reserveSell(s.db, s.a, request, now),
    after = await practiceAccount(s.db, s.a);
  assert.equal(receipt.executionEnabled, false);
  assert.deepEqual(receipt.estimate, {
    grossUnits: 48000,
    feeUnits: 120,
    netUnits: 47880,
  });
  assert.equal(after.positions[0].quantity, 5);
  assert.equal(after.positions[0].reservedQuantity, 2);
  assert.equal(after.positions[0].availableQuantity, 3);
  assert.equal(after.positionTotals.reservedQuantity, 2);
  assert.deepEqual(after.wallet, before.wallet);
  assert.deepEqual(after.fills, before.fills);
  assert.equal(after.sellOrders.length, 1);
  assert.equal(
    (await practiceAccount(s.db, s.b)).positions[0].reservedQuantity,
    0,
  );
  const replay = await reserveSell(s.db, s.a, request, now);
  assert.equal(replay.order.id, receipt.order.id);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    reserveSell(
      s.db,
      s.a,
      { ...request, intent: { ...request.intent, quantity: 3 } },
      now,
    ),
    (e) => e.code === "KEY_CONFLICT",
  );
});
test("simultaneous distinct and duplicate submissions cannot oversell", async () => {
  const s = await held(),
    r = sell({ quantity: 4 });
  const results = await Promise.allSettled([
    reserveSell(s.db, s.a, r, now),
    reserveSell(s.db, s.a, r, now),
    reserveSell(s.db, s.a, sell({ quantity: 4 }), now),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal(
    (await practiceAccount(s.db, s.a)).positions[0].reservedQuantity,
    4,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM practice_share_entries").get().n,
    1,
  );
});
test("no shares, wrong outcome, stale revision, forged owner and oversell are rejected", async () => {
  const s = await held();
  for (const request of [
    sell({ quantity: 6 }),
    sell({ outcome: "no" }),
    sell({ eventRevision: 2 }),
    sell({ eventId: crypto.randomUUID() }),
  ])
    await assert.rejects(
      reserveSell(s.db, s.a, request, now),
      (e) => e.code === "SELL_UNAVAILABLE",
    );
  await assert.rejects(
    reserveSell(s.db, s.a, { ...sell(), userId: "b" }, now),
    (e) => e.status === 400,
  );
  await assert.rejects(
    reserveSell(
      s.db,
      { userId: "c", email: "c@example.test", displayName: "C" },
      sell(),
      now,
    ),
    (e) => e.code === "SELL_UNAVAILABLE",
  );
  for (const quantity of [0, -1, 1.5, 10001])
    await assert.rejects(
      reserveSell(s.db, s.a, sell({ quantity }), now),
      (e) => e.status === 400,
    );
});
test("cancel is owned and idempotent, returns shares only and old replay never reopens", async () => {
  const s = await held(),
    request = sell(),
    r = await reserveSell(s.db, s.a, request, now),
    cash = (await practiceAccount(s.db, s.a)).wallet;
  await assert.rejects(
    cancelSell(s.db, s.b, { orderId: r.order.id }, now),
    (e) => e.status === 404,
  );
  await Promise.all([
    cancelSell(s.db, s.a, { orderId: r.order.id }, now),
    cancelSell(s.db, s.a, { orderId: r.order.id }, now),
  ]);
  const a = await practiceAccount(s.db, s.a);
  assert.equal(a.positions[0].availableQuantity, 5);
  assert.deepEqual(a.wallet, cash);
  assert.equal(
    (await reserveSell(s.db, s.a, request, now)).order.status,
    "cancelled",
  );
  assert.equal(
    s.sql
      .prepare("SELECT SUM(reserved_delta) n FROM practice_share_entries")
      .get().n,
    0,
  );
  await reserveSell(s.db, s.a, sell({ quantity: 5 }), now);
});
test("deadline, hidden event and revision changes release reservations exactly once", async () => {
  for (const mode of ["deadline", "hidden", "revision"]) {
    const s = await held(),
      r = await reserveSell(s.db, s.a, sell(), now);
    if (mode === "hidden")
      s.sql.exec("UPDATE own_events SET status='archived'");
    if (mode === "revision") s.sql.exec("UPDATE own_events SET revision=2");
    const clock = mode === "deadline" ? now + 86400001 : now;
    for (let i = 0; i < 2; i++) {
      const a = await practiceAccount(s.db, s.a, 0, clock);
      assert.equal(a.positions[0].reservedQuantity, 0);
      assert.equal(
        a.sellOrders[0].status,
        mode === "deadline" ? "expired" : "voided",
      );
    }
    assert.equal(
      s.sql
        .prepare(
          "SELECT COUNT(*) n FROM practice_share_entries WHERE kind='release'",
        )
        .get().n,
      1,
    );
    await assert.rejects(
      reserveSell(s.db, s.a, sell(), clock),
      (e) => e.code === "SELL_UNAVAILABLE",
    );
  }
});
test("suspended accounts cannot reserve or cancel; journal failure rolls back admission", async () => {
  const s = await held(),
    r = await reserveSell(s.db, s.a, sell(), now);
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(
    reserveSell(s.db, s.a, sell(), now),
    (e) => e.status === 403,
  );
  await assert.rejects(
    cancelSell(s.db, s.a, { orderId: r.order.id }, now),
    (e) => e.status === 403,
  );
  s.sql.exec("UPDATE app_users SET status='active' WHERE id='a'");
  s.inject();
  await assert.rejects(reserveSell(s.db, s.a, sell(), now), /injected/);
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM practice_sell_orders").get().n,
    1,
  );
});
test("reservation history paginates independently and never exposes another account", async () => {
  const s = await held();
  for (let i = 0; i < 23; i++) {
    const r = await reserveSell(s.db, s.a, sell(), now);
    await cancelSell(s.db, s.a, { orderId: r.order.id }, now);
  }
  const p = await practiceAccount(s.db, s.a),
    p2 = await practiceAccount(s.db, s.a, 0, now, 0, 1);
  assert.equal(p.sellOrders.length, 20);
  assert.equal(p.sellsHasMore, true);
  assert.equal(p2.sellOrders.length, 3);
  assert.equal(p2.sellsHasMore, false);
  assert.equal((await practiceAccount(s.db, s.b)).sellOrders.length, 0);
  for (const page of [-1, 0.5, 10001])
    await assert.rejects(practiceAccount(s.db, s.a, 0, now, 0, page));
});
