import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  cancelPractice,
  now,
  order,
} from "./helpers/practice.mjs";
const b = await build({
  entryPoints: ["lib/practice/fees.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { feeReport } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
test("empty fees, invalid page, inactive users and account isolation", async () => {
  const s = setup();
  assert.equal((await feeReport(s.db, s.a)).totals.chargedUnits, 0);
  await assert.rejects(feeReport(s.db, s.a, -1), { status: 400 });
  await startPractice(s.db, s.a);
  await placePractice(s.db, s.a, order({ quantity: 1 }), now);
  assert.equal((await feeReport(s.db, s.b)).totals.orders, 0);
  s.sql.exec("UPDATE app_users SET status='closed' WHERE id='a'");
  await assert.rejects(feeReport(s.db, s.a));
});
test("partial fill cancellation separates actual fees from released reservation and is read-only", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  const o = await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await placePractice(s.db, s.b, order({ quantity: 2, outcome: "no" }), now);
  const first = await feeReport(s.db, s.a);
  assert.equal(first.totals.chargedUnits, 120);
  assert.equal(first.totals.heldUnits, 24060);
  await cancelPractice(s.db, s.a, { orderId: o.order.id }, now);
  const before = s.sql
    .prepare("SELECT * FROM practice_cash WHERE user_id=?")
    .get("a");
  const r = await feeReport(s.db, s.a);
  assert.equal(r.totals.chargedUnits, 120);
  assert.equal(r.totals.releasedUnits, 24060);
  assert.equal(r.totals.heldUnits, 0);
  assert.equal(r.refundedFeeUnits, 0);
  assert.deepEqual(
    s.sql.prepare("SELECT * FROM practice_cash WHERE user_id=?").get("a"),
    before,
  );
  const other = await feeReport(s.db, s.b);
  assert.equal(other.totals.chargedUnits, 80);
  assert.equal(other.totals.releasedUnits, 16040);
});
test("unfilled cancellation charges no fee; all-history totals survive pagination", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  for (let i = 0; i < 26; i++) {
    const o = await placePractice(
      s.db,
      s.a,
      order({ quantity: 1, limitPriceCents: 1 }),
      now + i,
    );
    await cancelPractice(s.db, s.a, { orderId: o.order.id }, now + i);
  }
  const a = await feeReport(s.db, s.a),
    b = await feeReport(s.db, s.a, 1);
  assert.equal(a.entries.length, 25);
  assert.equal(b.entries.length, 1);
  assert.equal(a.totals.chargedUnits, 0);
  assert.equal(a.totals.releasedUnits, 26 * 401);
  assert.deepEqual(a.totals, b.totals);
  assert.equal(new Set([...a.entries, ...b.entries].map((e) => e.id)).size, 26);
});
test("multiple fills aggregate once and historical charged amounts are preserved", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  const a = await placePractice(
    s.db,
    s.a,
    order({ quantity: 2, limitPriceCents: 1 }),
    now,
  );
  await placePractice(
    s.db,
    s.b,
    order({ quantity: 1, outcome: "no", limitPriceCents: 99 }),
    now + 1,
  );
  await placePractice(
    s.db,
    s.b,
    order({ quantity: 1, outcome: "no", limitPriceCents: 99 }),
    now + 2,
  );
  const r = await feeReport(s.db, s.a);
  assert.equal(r.totals.chargedUnits, 2);
  assert.equal(r.totals.principalUnits, 800);
  assert.equal(r.entries.length, 1);
});

test("legacy rounded fee receipts are shown without recomputing current policy", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  const a = await placePractice(
    s.db,
    s.a,
    order({ quantity: 1, limitPriceCents: 1 }),
    now,
  );
  s.sql
    .prepare(
      "UPDATE practice_order_progress SET fee_policy='legacy_order' WHERE order_id=?",
    )
    .run(a.order.id);
  await placePractice(
    s.db,
    s.b,
    order({ quantity: 1, outcome: "no", limitPriceCents: 99 }),
    now + 1,
  );
  const r = await feeReport(s.db, s.a);
  assert.equal(r.totals.chargedUnits, 0);
  assert.equal(r.entries[0].policy, "legacy_order");
  assert.equal(r.totals.releasedUnits, 1);
});
