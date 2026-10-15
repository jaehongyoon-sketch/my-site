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
const req = (id) => ({ orderId: id });
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
function reconcile(sql, user = "a") {
  const cash = sql
    .prepare("SELECT * FROM practice_cash WHERE user_id=?")
    .get(user);
  const journal = sql
    .prepare(
      "SELECT sum(available_delta_units) a,sum(reserved_delta_units) r FROM practice_cash_entries WHERE user_id=?",
    )
    .get(user);
  const fills = sql
    .prepare(
      "SELECT COALESCE(sum(released_units),0) a,COALESCE(sum(reserved_debit_units),0) r,COALESCE(sum(principal_units+fee_units),0) s FROM practice_match_entries WHERE user_id=?",
    )
    .get(user);
  assert.equal(cash.available_units, journal.a + fills.a);
  assert.equal(cash.reserved_units, journal.r - fills.r);
  assert.equal(cash.spent_units, fills.s);
}
test("cancel open order returns all held funds once and retains an immutable receipt", async () => {
  const { db, sql, a } = await funded();
  const x = await placePractice(db, a, order({ quantity: 3 }), now);
  const [c, d] = await Promise.all([
    cancelPractice(db, a, req(x.order.id), now),
    cancelPractice(db, a, req(x.order.id), now),
  ]);
  assert.deepEqual(c, d);
  assert.equal(c.outcome, "cancelled");
  assert.equal(c.receipt.refundedCents, 180.45);
  assert.equal(c.receipt.quantity, 3);
  const s = await practiceAccount(db, a);
  assert.equal(s.orders[0].status, "cancelled");
  assert.equal(s.wallet.availableCents, 100000);
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) n FROM practice_cash_entries WHERE kind='release'",
      )
      .get().n,
    1,
  );
  reconcile(sql);
});
test("partial cancellation preserves filled cost, fee and fills, releases only remainder", async () => {
  const { db, sql, a, b } = await funded();
  const x = await placePractice(db, a, order({ quantity: 3 }), now);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  const c = await cancelPractice(db, a, req(x.order.id), now);
  assert.equal(c.receipt.quantity, 2);
  assert.equal(c.receipt.refundedCents, 120.3);
  const s = await practiceAccount(db, a);
  assert.equal(s.orders[0].filled_quantity, 1);
  assert.equal(s.orders[0].chargedFeeCents, 0.15);
  assert.equal(s.wallet.spentCents, 60.15);
  assert.equal(s.fills.length, 1);
  reconcile(sql);
});
test("filled and expired orders are not reported as cancelled", async () => {
  for (const expired of [false, true]) {
    const { db, sql, a, b } = await funded();
    const x = await placePractice(db, a, order({ quantity: 1 }), now);
    if (!expired)
      await placePractice(
        db,
        b,
        order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
        now,
      );
    const c = await cancelPractice(
      db,
      a,
      req(x.order.id),
      expired ? now + 86400001 : now,
    );
    assert.equal(c.outcome, expired ? "already_closed" : "already_filled");
    assert.equal(c.receipt, null);
    assert.equal(
      sql.prepare("SELECT count(*) n FROM practice_cancellations").get().n,
      0,
    );
    reconcile(sql);
  }
});
test("ownership, inactive account and forged cancellation input are rejected", async () => {
  const { db, sql, a, b } = await funded();
  const x = await placePractice(db, a, order(), now);
  await assert.rejects(
    cancelPractice(db, b, req(x.order.id)),
    (e) => e.status === 404,
  );
  await assert.rejects(
    cancelPractice(db, a, { ...req(x.order.id), refundedCents: 9999 }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    cancelPractice(db, a, req(crypto.randomUUID())),
    (e) => e.status === 404,
  );
  sql.prepare("UPDATE app_users SET status='suspended' WHERE id='a'").run();
  await assert.rejects(
    cancelPractice(db, a, req(x.order.id)),
    (e) => e.status === 403,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_cancellations").get().n,
    0,
  );
  reconcile(sql);
});
test("cancellation wins after matcher reads candidate: no stale fill commits", async () => {
  const { db, sql, a, b } = await funded();
  const x = await placePractice(db, a, order({ quantity: 3 }), now);
  const batch = db.batch;
  let race = false;
  db.batch = async (stmts) => {
    if (!race && stmts[0].query.includes("INSERT INTO practice_matches")) {
      race = true;
      await cancelPractice(db, a, req(x.order.id), now);
    }
    return batch(stmts);
  };
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  assert.ok(race);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  assert.equal((await practiceAccount(db, a)).wallet.availableCents, 100000);
  reconcile(sql);
});
test("fill wins before cancellation transaction: refund uses new remaining quantity", async () => {
  const { db, sql, a, b } = await funded();
  const x = await placePractice(db, a, order({ quantity: 3 }), now);
  const batch = db.batch;
  let race = false;
  db.batch = async (stmts) => {
    if (
      !race &&
      stmts[0].query.includes("INSERT INTO practice_cancellations")
    ) {
      race = true;
      await placePractice(
        db,
        b,
        order({ outcome: "no", limitPriceCents: 40, quantity: 2 }),
        now,
      );
    }
    return batch(stmts);
  };
  const c = await cancelPractice(db, a, req(x.order.id), now);
  assert.ok(race);
  assert.equal(c.receipt.quantity, 1);
  assert.equal(c.receipt.refundedCents, 60.15);
  assert.equal((await practiceAccount(db, a)).orders[0].filled_quantity, 2);
  reconcile(sql);
});
test("failed cancellation ledger write rolls back cancellation marker and cash; retry succeeds", async () => {
  const { db, sql, a } = await funded();
  const x = await placePractice(db, a, order({ quantity: 1 }), now);
  const batch = db.batch;
  let inject = true;
  db.batch = async (stmts) => {
    if (
      inject &&
      stmts[0].query.includes("INSERT INTO practice_cancellations")
    ) {
      inject = false;
      const bad = {
        runSync() {
          throw Error("injected failure");
        },
      };
      return batch([...stmts.slice(0, 3), bad, ...stmts.slice(3)]);
    }
    return batch(stmts);
  };
  await assert.rejects(cancelPractice(db, a, req(x.order.id), now));
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_cancellations").get().n,
    0,
  );
  assert.equal((await practiceAccount(db, a)).orders[0].heldCents, 60.15);
  await cancelPractice(db, a, req(x.order.id), now);
  reconcile(sql);
});
test("cancelled order submission retry cannot reopen or reserve it again", async () => {
  const { db, sql, a, b } = await funded();
  const input = order({ quantity: 1 }),
    x = await placePractice(db, a, input, now);
  await cancelPractice(db, a, req(x.order.id), now);
  const again = await placePractice(db, a, input, now);
  assert.equal(again.order.status, "cancelled");
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  reconcile(sql);
});
