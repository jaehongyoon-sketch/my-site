import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  cancelPractice,
  practiceAccount,
  now,
  eventId,
  order,
} from "./helpers/practice.mjs";
async function mod(p) {
  const b = await build({
    entryPoints: [p],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(b.outputFiles[0].text).toString("base64")
  );
}
const { reconcilePractice } = await mod("lib/reconciliation/service.ts");
const { reserveSell, cancelSell } = await mod("lib/practice/sells.ts");
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
async function filled() {
  const s = await funded();
  const a = await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await placePractice(s.db, s.b, order({ quantity: 2, outcome: "no" }), now);
  return { ...s, orderId: a.order.id };
}
const check = (r, code) => r.checks.find((c) => c.code === code);
test("empty account is not-started, read-only; grant-only account passes applicable checks", async () => {
  const s = setup();
  const changes = s.sql.prepare("SELECT total_changes() n").get().n;
  const e = await reconcilePractice(s.db, s.a);
  assert.equal(e.status, "not_started");
  assert.equal(e.failureCount, 0);
  assert.equal(s.sql.prepare("SELECT total_changes() n").get().n, changes);
  await startPractice(s.db, s.a);
  assert.equal((await reconcilePractice(s.db, s.a)).status, "passed");
});
test("partial fills, price improvement, cancellation, sells and expiry reconcile without mutations", async () => {
  const s = await filled();
  for (const actor of [s.a, s.b])
    assert.equal((await reconcilePractice(s.db, actor)).status, "passed");
  await cancelPractice(s.db, s.a, { orderId: s.orderId }, now);
  const sale = await reserveSell(
    s.db,
    s.a,
    order({ side: "sell", quantity: 1 }),
    now,
  );
  assert.equal((await reconcilePractice(s.db, s.a)).status, "passed");
  await cancelSell(s.db, s.a, { orderId: sale.order.id }, now);
  await placePractice(s.db, s.a, order({ quantity: 1 }), now);
  await practiceAccount(s.db, s.a, 0, now + 86400001);
  const before = s.sql.prepare("SELECT total_changes() n").get().n;
  assert.equal((await reconcilePractice(s.db, s.a)).status, "passed");
  assert.equal(s.sql.prepare("SELECT total_changes() n").get().n, before);
});
test("cash journal mismatch is detected exactly and cannot repair cash", async () => {
  const s = await funded();
  s.sql.exec(
    "UPDATE practice_cash SET available_units=available_units-1,reserved_units=reserved_units+1 WHERE user_id='a'",
  );
  const r = await reconcilePractice(s.db, s.a);
  assert.equal(r.status, "mismatch");
  assert.equal(check(r, "cash_available").failed, 1);
  assert.equal(check(r, "cash_reserved").failed, 1);
  assert.equal(check(r, "reserved_orders").failed, 1);
  assert.equal(
    r.differences.find((d) => d.code === "cash_available").actual,
    39999999,
  );
  assert.equal((await reconcilePractice(s.db, s.b)).status, "passed");
});
test("order quantity and cost projections are checked independently of match entries", async () => {
  const s = await filled();
  s.sql
    .prepare(
      "UPDATE practice_order_progress SET filled_quantity=0,executed_principal_units=0,charged_fee_units=0 WHERE order_id=?",
    )
    .run(s.orderId);
  const r = await reconcilePractice(s.db, s.a);
  for (const code of ["order_quantity", "order_principal", "order_fee"])
    assert.equal(check(r, code).failed, 1);
  assert.equal(check(r, "fill_principal").failed, 0);
});
test("missing own and counterpart fill receipts are detected without exposing counterpart identities", async () => {
  const s = await filled();
  s.sql.prepare("DELETE FROM practice_match_entries WHERE user_id=?").run("b");
  const a = await reconcilePractice(s.db, s.a);
  assert.equal(check(a, "pair").failed, 1);
  assert.equal(check(a, "fill_entries").failed, 0);
  const b = await reconcilePractice(s.db, s.b);
  assert.equal(check(b, "fill_entries").failed, 1);
  assert.equal(check(b, "fill_principal").failed, 1);
  assert.ok(a.differences.every((d) => !Object.hasOwn(d, "userId")));
});
test("sub-cent fees and historical fee policy validation use exact integer units", async () => {
  const s = await funded();
  const a = await placePractice(
    s.db,
    s.a,
    order({ quantity: 1, limitPriceCents: 1 }),
    now,
  );
  await placePractice(
    s.db,
    s.b,
    order({ outcome: "no", quantity: 1, limitPriceCents: 99 }),
    now,
  );
  assert.equal((await reconcilePractice(s.db, s.a)).status, "passed");
  s.sql
    .prepare(
      "UPDATE practice_order_progress SET fee_policy='legacy_order' WHERE order_id=?",
    )
    .run(a.order.id);
  const r = await reconcilePractice(s.db, s.a);
  assert.equal(r.differences.find((d) => d.code === "order_fee").expected, 0);
  assert.equal(r.differences.find((d) => d.code === "order_fee").actual, 1);
  assert.equal(check(r, "fill_fees").failed, 1);
});
test("missing share entries and over-reserved holdings have separate diagnostic checks", async () => {
  const s = await filled();
  const sale = await reserveSell(
    s.db,
    s.a,
    order({ side: "sell", quantity: 1 }),
    now,
  );
  s.sql
    .prepare("DELETE FROM practice_share_entries WHERE sell_id=?")
    .run(sale.order.id);
  let r = await reconcilePractice(s.db, s.a);
  assert.equal(check(r, "share_journal").failed, 1);
  assert.equal(check(r, "share_entries").failed, 1);
  s.sql
    .prepare("UPDATE practice_sell_orders SET quantity=3 WHERE id=?")
    .run(sale.order.id);
  r = await reconcilePractice(s.db, s.a);
  assert.equal(check(r, "holdings").failed, 1);
});
test("all records are checked beyond detail and history limits, failures limited only in presentation", async () => {
  const s = await funded();
  for (let i = 0; i < 60; i++)
    await placePractice(s.db, s.a, order({ quantity: 1 }), now);
  s.sql.exec(
    "UPDATE practice_order_progress SET filled_quantity=1 WHERE order_id IN (SELECT id FROM practice_orders WHERE user_id='a')",
  );
  const r = await reconcilePractice(s.db, s.a);
  assert.equal(check(r, "order_quantity").failed, 60);
  assert.equal(r.scope.orders, 60);
  assert.equal(r.differences.length, 50);
  assert.equal(r.detailsTruncated, true);
  assert.equal(r.failureCount, 60);
});
test("inactive accounts are denied; trading restriction does not hide diagnostics", async () => {
  const s = await funded();
  s.sql
    .prepare("INSERT INTO trading_restrictions VALUES (?,?,?,?,?,?,?)")
    .run(
      "a",
      1,
      1,
      crypto.randomUUID(),
      "Review required",
      "a",
      new Date().toISOString(),
    );
  assert.equal((await reconcilePractice(s.db, s.a)).status, "passed");
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(reconcilePractice(s.db, s.a), (e) => e.status === 403);
});

test("migrated legacy order and rounded fee reconcile before and after fill", async () => {
  const s = setup(true),
    { db, sql, a, b } = s,
    id = crypto.randomUUID();
  const { readFileSync } = await import("node:fs");
  sql
    .prepare("INSERT INTO practice_wallets VALUES (?,?,?,?,?)")
    .run("a", 99999, 1, "grant-old", new Date(now).toISOString());
  sql
    .prepare("INSERT INTO practice_ledger VALUES (?,?,?,?,?,?,?)")
    .run(
      "grant-old",
      "a",
      null,
      "grant",
      100000,
      0,
      new Date(now).toISOString(),
    );
  sql
    .prepare(
      "INSERT INTO practice_orders (id,user_id,event_id,client_id,intent_json,event_revision,event_title,outcome,price_cents,quantity,principal_cents,fee_cents,total_cents,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "a",
      eventId,
      crypto.randomUUID(),
      "{}",
      1,
      "Legacy test",
      "yes",
      1,
      1,
      1,
      0,
      1,
      "open",
      "2099-01-01T00:00:00.000Z",
      new Date(now).toISOString(),
    );
  sql
    .prepare("INSERT INTO practice_ledger VALUES (?,?,?,?,?,?,?)")
    .run("reserve-old", "a", id, "reserve", -1, 1, new Date(now).toISOString());
  sql.exec(
    readFileSync(
      new URL("../drizzle/0006_secret_swordsman.sql", import.meta.url),
      "utf8",
    ),
  );

  assert.equal((await reconcilePractice(db, a)).status, "passed");
  await startPractice(db, b);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 99, quantity: 1 }),
    now,
  );
  assert.equal((await reconcilePractice(db, a)).status, "passed");
});
