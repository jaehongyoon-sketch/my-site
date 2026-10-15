import test from "node:test";
import assert from "node:assert/strict";
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
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
async function pair(s, price, quantity, extra = {}) {
  await placePractice(
    s.db,
    s.a,
    order({ limitPriceCents: price, quantity, ...extra }),
    now,
  );
  await placePractice(
    s.db,
    s.b,
    order({
      outcome: extra.outcome === "no" ? "yes" : "no",
      limitPriceCents: 100 - price,
      quantity,
      eventId: extra.eventId ?? eventId,
    }),
    now,
  );
}
test("empty and unfilled orders are not holdings; partial cancellation keeps only fills", async () => {
  const s = await funded();
  assert.equal((await practiceAccount(s.db, s.a)).positions.length, 0);
  const x = await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  assert.equal((await practiceAccount(s.db, s.a)).positionTotals.quantity, 0);
  await placePractice(
    s.db,
    s.b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  await cancelPractice(s.db, s.a, { orderId: x.order.id }, now);
  const d = await practiceAccount(s.db, s.a);
  assert.equal(d.positions[0].quantity, 1);
  assert.equal(d.positions[0].principalUnits, 24000);
  assert.equal(d.positions[0].feeUnits, 60);
  assert.equal(d.positionTotals.costBasisUnits, 24060);
  assert.ok(d.positionsReconciled);
});
test("multiple execution prices use quantity weighting and keep YES and NO separate", async () => {
  const s = await funded();
  await pair(s, 60, 1);
  await pair(s, 40, 3);
  await pair(s, 50, 2, { outcome: "no" });
  const d = await practiceAccount(s.db, s.a);
  const yes = d.positions.find((p) => p.outcome === "yes"),
    no = d.positions.find((p) => p.outcome === "no");
  assert.equal(yes.quantity, 4);
  assert.equal(yes.principalUnits / 400 / yes.quantity, 45);
  assert.equal(yes.feeUnits, 180);
  assert.equal(yes.costBasisUnits / 400 / yes.quantity, 45.1125);
  assert.equal(no.quantity, 2);
  assert.equal(d.positionTotals.quantity, 6);
  assert.equal(d.positionTotals.positionCount, 2);
  assert.equal(d.positionTotals.costBasisUnits, d.positionTotals.spentUnits);
});
test("holdings include more than the 50 most recent fills and repeated reads never mutate them", async () => {
  const s = await funded();
  for (let i = 0; i < 51; i++) await pair(s, 1, 1);
  const d = await practiceAccount(s.db, s.a);
  assert.equal(d.fills.length, 50);
  assert.equal(d.positions[0].quantity, 51);
  assert.equal(d.positions[0].feeUnits, 51);
  assert.equal(d.positions[0].costBasisUnits, 51 * 401);
  const again = await practiceAccount(s.db, s.a);
  assert.deepEqual(again.positions, d.positions);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    51,
  );
});
test("archived and expired events retain holdings; other accounts only see their own side", async () => {
  const s = await funded();
  await pair(s, 60, 1);
  s.sql.prepare("UPDATE own_events SET status='archived'").run();
  const a = await practiceAccount(s.db, s.a, 0, now + 86400001);
  assert.equal(a.positions.length, 1);
  assert.equal(a.positions[0].eventStatus, "archived");
  assert.equal(a.positions[0].outcome, "yes");
  const b = await practiceAccount(s.db, s.b);
  assert.equal(b.positions[0].outcome, "no");
  assert.equal(b.positions[0].principalUnits, 16000);
  const c = await practiceAccount(s.db, {
    userId: "c",
    email: "c@example.test",
    displayName: "C",
  });
  assert.equal(c.positions.length, 0);
  assert.equal(c.positionTotals.costBasisUnits, 0);
});
test("holdings paginate independently while totals cover every event", async () => {
  const s = await funded();
  for (let i = 0; i < 21; i++) {
    const eid = crypto.randomUUID();
    s.sql
      .prepare(
        "INSERT INTO own_events SELECT ?,title,category,rules,source_url,closes_at,status,revision,updated_by,created_at,updated_at FROM own_events WHERE id=?",
      )
      .run(eid, eventId);
    await pair(s, 50, 1, { eventId: eid });
  }
  const p0 = await practiceAccount(s.db, s.a, 0, now, 0),
    p1 = await practiceAccount(s.db, s.a, 0, now, 1);
  assert.equal(p0.positions.length, 20);
  assert.ok(p0.positionsHasMore);
  assert.equal(p1.positions.length, 1);
  assert.equal(p1.positionsHasMore, false);
  assert.equal(
    new Set([...p0.positions, ...p1.positions].map((p) => p.eventId)).size,
    21,
  );
  assert.deepEqual(p0.positionTotals, p1.positionTotals);
  assert.equal(p0.positionTotals.quantity, 21);
  await assert.rejects(
    practiceAccount(s.db, s.a, 0, now, -1),
    (e) => e.status === 400,
  );
  await assert.rejects(
    practiceAccount(s.db, s.a, 0, now, 1.5),
    (e) => e.status === 400,
  );
});
test("a cash versus fill discrepancy is surfaced rather than reported as reconciled", async () => {
  const s = await funded();
  await pair(s, 60, 1);
  s.sql
    .prepare(
      "UPDATE practice_cash SET available_units=available_units-1,spent_units=spent_units+1 WHERE user_id='a'",
    )
    .run();
  const d = await practiceAccount(s.db, s.a);
  assert.equal(d.positionsReconciled, false);
  assert.equal(d.positionTotals.costBasisUnits, 24060);
  assert.equal(d.positionTotals.spentUnits, 24061);
});
