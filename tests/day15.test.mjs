import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
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
async function module(path) {
  const b = await build({
    entryPoints: [path],
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
const { cashJournal } = await module("lib/practice/journal.ts");
const { fundingStatus, requestFunding } = await module(
  "lib/funding/service.ts",
);
const { transitionTransfer, disconnectedProvider, fundingIntentSchema } =
  await module("lib/funding/model.ts");
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
test("journal has no invented grant before practice starts and reads do not mutate", async () => {
  const s = setup(),
    before = s.sql.prepare("SELECT total_changes() n").get().n,
    j = await cashJournal(s.db, s.a);
  assert.equal(j.wallet, null);
  assert.deepEqual(j.entries, []);
  assert.equal(j.reconciled, true);
  assert.equal(j.totals.entryCount, 0);
  assert.equal(s.sql.prepare("SELECT total_changes() n").get().n, before);
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.a);
  const granted = await cashJournal(s.db, s.a);
  assert.equal(granted.entries.length, 1);
  assert.equal(granted.entries[0].kind, "grant");
  assert.equal(granted.wallet.availableUnits, 40000000);
});
test("full cash journal reconciles grant, partial fill, price improvement, fee and cancellation", async () => {
  const s = await funded();
  const a = await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await placePractice(
    s.db,
    s.b,
    order({ quantity: 2, outcome: "no", limitPriceCents: 60 }),
    now,
  );
  await cancelPractice(s.db, s.a, { orderId: a.order.id }, now);
  for (const actor of [s.a, s.b]) {
    const j = await cashJournal(s.db, actor);
    assert.equal(j.reconciled, true);
    assert.equal(
      j.totals.availableUnits + j.totals.reservedUnits + j.totals.spentUnits,
      40000000,
    );
    assert.equal(
      j.totals.spentUnits,
      j.totals.principalUnits + j.totals.feeUnits,
    );
  }
  const ja = await cashJournal(s.db, s.a),
    jb = await cashJournal(s.db, s.b);
  assert.deepEqual(ja.entries.map((e) => e.kind).sort(), [
    "fill",
    "grant",
    "release",
    "reserve",
  ]);
  assert.equal(
    ja.entries.find((e) => e.kind === "release").reason,
    "cancelled",
  );
  assert.equal(ja.totals.principalUnits, 48000);
  assert.equal(ja.totals.feeUnits, 120);
  assert.equal(jb.entries.find((e) => e.kind === "fill").availableUnits, 16040);
  assert.equal(jb.totals.principalUnits, 32000);
  assert.equal(jb.totals.feeUnits, 80);
  assert.ok(
    ja.entries.every((e) => e.orderId === null || e.orderId === a.order.id),
  );
});
test("one-cent per-contract fees keep sub-cent precision and no sell reservation enters cash journal", async () => {
  const s = await funded();
  await placePractice(
    s.db,
    s.a,
    order({ quantity: 1, limitPriceCents: 1 }),
    now,
  );
  await placePractice(
    s.db,
    s.b,
    order({ quantity: 1, outcome: "no", limitPriceCents: 99 }),
    now,
  );
  const j = await cashJournal(s.db, s.a);
  assert.equal(j.totals.feeUnits, 1);
  assert.equal(j.reconciled, true);
  const { reserveSell, cancelSell } = await module("lib/practice/sells.ts");
  const r = await reserveSell(
    s.db,
    s.a,
    order({ side: "sell", quantity: 1 }),
    now,
  );
  await cancelSell(s.db, s.a, { orderId: r.order.id }, now);
  const after = await cashJournal(s.db, s.a);
  assert.deepEqual(after.entries, j.entries);
  assert.deepEqual(after.totals, j.totals);
});
test("hidden/expired release records come from committed releases and no duplicate appears", async () => {
  for (const hidden of [true, false]) {
    const s = await funded();
    await placePractice(s.db, s.a, order({ quantity: 2 }), now);
    if (hidden) s.sql.exec("UPDATE own_events SET status='archived'");
    await practiceAccount(s.db, s.a, 0, hidden ? now : now + 86400001);
    await practiceAccount(s.db, s.a, 0, hidden ? now : now + 86400001);
    const j = await cashJournal(s.db, s.a);
    assert.equal(j.entries.filter((e) => e.kind === "release").length, 1);
    assert.equal(
      j.entries.find((e) => e.kind === "release").reason,
      hidden ? "voided" : "expired",
    );
    assert.equal(j.reconciled, true);
    assert.equal(j.wallet.availableUnits, 40000000);
  }
});
test("filters and stable pages do not truncate totals or overlap records", async () => {
  const s = await funded();
  for (let i = 0; i < 15; i++) {
    const a = await placePractice(s.db, s.a, order({ quantity: 1 }), now);
    await cancelPractice(s.db, s.a, { orderId: a.order.id }, now);
  }
  const first = await cashJournal(s.db, s.a),
    second = await cashJournal(s.db, s.a, { page: 1 }),
    released = await cashJournal(s.db, s.a, { kind: "release" });
  assert.equal(first.entries.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(second.entries.length, 6);
  assert.equal(second.hasMore, false);
  assert.equal(
    new Set([...first.entries, ...second.entries].map((e) => e.id)).size,
    31,
  );
  assert.deepEqual(first.totals, second.totals);
  assert.deepEqual(first.totals, released.totals);
  assert.equal(released.filteredCount, 15);
  assert.equal((await cashJournal(s.db, s.b)).entries.length, 1);
  for (const raw of [
    { page: -1 },
    { page: 0.5 },
    { page: 10001 },
    { kind: "secret" },
    { userId: "b" },
  ])
    await assert.rejects(cashJournal(s.db, s.a, raw), (e) => e.status === 400);
});
test("journal flags a discrepancy rather than silently repairing balances; uses account index", async () => {
  const s = await funded();
  s.sql.exec(
    "UPDATE practice_cash SET available_units=available_units-400,reserved_units=reserved_units+400 WHERE user_id='a'",
  );
  const before = s.sql.prepare("SELECT total_changes() n").get().n;
  assert.equal((await cashJournal(s.db, s.a)).reconciled, false);
  assert.equal(s.sql.prepare("SELECT total_changes() n").get().n, before);
  const plans = s.sql
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM practice_cash_entries WHERE user_id=? ORDER BY created_at",
    )
    .all("a");
  assert.ok(
    plans.some((p) => p.detail.includes("practice_cash_entry_user_time")),
  );
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(cashJournal(s.db, s.a), (e) => e.status === 403);
});
test("migrated Day 10 grant is included once without duplicating legacy records", async () => {
  const s = setup(true),
    stamp = new Date(now).toISOString();
  s.sql
    .prepare("INSERT INTO practice_wallets VALUES (?,?,?,?,?)")
    .run("a", 100000, 0, "old-grant", stamp);
  s.sql
    .prepare("INSERT INTO practice_ledger VALUES (?,?,?,?,?,?,?)")
    .run("old-grant", "a", null, "grant", 100000, 0, stamp);
  // The fixture intentionally omits these dependent migrations for Day 10 data.
  const { readdirSync } = await import("node:fs");
  for (const prefix of ["0006", "0010"]) {
    const f = readdirSync("drizzle").find(
      (f) => f.startsWith(prefix) && f.endsWith(".sql"),
    );
    s.sql.exec(readFileSync("drizzle/" + f, "utf8"));
  }
  const j = await cashJournal(s.db, s.a);
  assert.equal(j.entries.length, 1);
  assert.equal(j.totals.grantUnits, 40000000);
  assert.equal(j.reconciled, true);
});
test("funding status and rejected requests never create transfers or change practice cash", async () => {
  const s = await funded(),
    before = s.sql.prepare("SELECT total_changes() n").get().n;
  const status = await fundingStatus(s.db, s.a);
  assert.equal(status.depositsEnabled, false);
  assert.equal(status.withdrawalsEnabled, false);
  assert.deepEqual(status.transfers, []);
  for (const direction of ["deposit", "withdrawal"])
    await assert.rejects(
      requestFunding(s.db, s.a, {
        requestId: crypto.randomUUID(),
        direction,
        currency: "USD",
        amountCents: 100,
      }),
      (e) => e.status === 503 && e.code === "FUNDING_NOT_CONNECTED",
    );
  assert.equal(s.sql.prepare("SELECT total_changes() n").get().n, before);
  await assert.rejects(
    requestFunding(s.db, s.a, { amountCents: 100 }),
    (e) => e.status === 400,
  );
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(fundingStatus(s.db, s.a), (e) => e.status === 403);
});
test("funding contract rejects forged identifiers, unsafe amounts, currency and status", async () => {
  const valid = {
    requestId: crypto.randomUUID(),
    direction: "withdrawal",
    currency: "USD",
    amountCents: 100,
  };
  assert.ok(fundingIntentSchema.safeParse(valid).success);
  for (const changed of [
    { amountCents: 0 },
    { amountCents: 1.5 },
    { amountCents: Infinity },
    { amountCents: 10000001 },
    { currency: "BTC" },
    { accountId: "a" },
    { status: "succeeded" },
  ])
    assert.equal(
      fundingIntentSchema.safeParse({ ...valid, ...changed }).success,
      false,
    );
  await assert.rejects(
    disconnectedProvider.createTransfer({
      ...valid,
      verifiedAccountReference: "test",
    }),
    (e) => e.status === 503,
  );
  await assert.rejects(
    disconnectedProvider.getTransfer("test"),
    (e) => e.status === 503,
  );
});
test("transfer state model handles duplicates and reversal but rejects invalid/reopening transitions", () => {
  for (const [from, to] of [
    ["pending", "processing"],
    ["pending", "cancelled"],
    ["processing", "succeeded"],
    ["processing", "failed"],
    ["succeeded", "reversed"],
  ])
    assert.equal(transitionTransfer(from, to), to);
  for (const state of [
    "pending",
    "processing",
    "succeeded",
    "failed",
    "cancelled",
    "reversed",
  ])
    assert.equal(transitionTransfer(state, state), state);
  for (const [from, to] of [
    ["pending", "succeeded"],
    ["succeeded", "failed"],
    ["failed", "processing"],
    ["cancelled", "processing"],
    ["reversed", "succeeded"],
  ])
    assert.throws(() => transitionTransfer(from, to));
});
