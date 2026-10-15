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
const { syncTradeEvents, readTradeEvents } = await mod(
  "lib/trade-events/service.ts",
);
const { reserveSell, cancelSell } = await mod("lib/practice/sells.ts");
const sync = (s, actor = s.a) =>
  syncTradeEvents(s.db, actor, { action: "sync" });
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
async function history() {
  const s = await funded();
  const a = await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await placePractice(s.db, s.b, order({ quantity: 2, outcome: "no" }), now);
  await cancelPractice(s.db, s.a, { orderId: a.order.id }, now);
  const sale = await reserveSell(
    s.db,
    s.a,
    order({ side: "sell", quantity: 1 }),
    now,
  );
  await cancelSell(s.db, s.a, { orderId: sale.order.id }, now);
  return s;
}
test("saved buy, fill, buy release and sell transitions generate owned events with no money changes", async () => {
  const s = await history(),
    before = await practiceAccount(s.db, s.a);
  const empty = await readTradeEvents(s.db, s.a);
  assert.equal(empty.counts.unrecorded, 5);
  assert.equal(empty.events.length, 0);
  const r = await sync(s);
  assert.deepEqual(r.events.map((e) => e.kind).sort(), [
    "buy_accepted",
    "buy_filled",
    "buy_released",
    "sell_released",
    "sell_reserved",
  ]);
  assert.equal(r.counts.processed, 5);
  assert.equal(r.hasMoreToSync, false);
  assert.equal(r.events.find((e) => e.kind === "buy_released").quantity, 1);
  const after = await practiceAccount(s.db, s.a);
  assert.deepEqual(after.wallet, before.wallet);
  assert.deepEqual(after.fills, before.fills);
  assert.deepEqual(after.positionTotals, before.positionTotals);
  assert.ok(r.events.every((e) => e.processedAt !== null));
  assert.equal((await readTradeEvents(s.db, s.b)).events.length, 0);
});
test("repeated concurrent sync is idempotent, including receipt timestamps", async () => {
  const s = await history();
  const r = await sync(s);
  await Promise.all([sync(s), sync(s), sync(s)]);
  assert.deepEqual((await readTradeEvents(s.db, s.a)).events, r.events);
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM practice_trade_events").get().n,
    5,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM practice_trade_receipts").get().n,
    5,
  );
});
test("processor failure retains staged records; retry resumes without duplicate side effects", async () => {
  const s = await history();
  s.sql.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON practice_trade_receipts BEGIN SELECT RAISE(ABORT,'processor unavailable'); END",
  );
  await assert.rejects(sync(s), /processor unavailable/);
  const failed = await readTradeEvents(s.db, s.a);
  assert.equal(failed.counts.pending, 5);
  assert.equal(failed.counts.unrecorded, 0);
  assert.equal(failed.counts.processed, 0);
  s.sql.exec("DROP TRIGGER reject_receipt");
  assert.equal((await sync(s)).counts.processed, 5);
});
test("collection failure rolls back the entire batch and committed sources remain recoverable", async () => {
  const s = await history();
  s.sql.exec(
    "CREATE TRIGGER reject_event BEFORE INSERT ON practice_trade_events WHEN NEW.kind='buy_filled' BEGIN SELECT RAISE(ABORT,'collect unavailable'); END",
  );
  await assert.rejects(sync(s), /collect unavailable/);
  assert.equal((await readTradeEvents(s.db, s.a)).counts.recorded, 0);
  assert.equal((await readTradeEvents(s.db, s.a)).counts.unrecorded, 5);
  s.sql.exec("DROP TRIGGER reject_event");
  assert.equal((await sync(s)).counts.processed, 5);
});
test("bounded processing and stable pagination eventually drain more than 100 records", async () => {
  const s = await funded();
  for (let i = 0; i < 55; i++) {
    const a = await placePractice(s.db, s.a, order({ quantity: 1 }), now);
    await cancelPractice(s.db, s.a, { orderId: a.order.id }, now);
  }
  let r = await sync(s);
  assert.deepEqual(r.counts, {
    recorded: 100,
    pending: 50,
    processed: 50,
    unrecorded: 10,
  });
  r = await sync(s);
  assert.deepEqual(r.counts, {
    recorded: 110,
    pending: 10,
    processed: 100,
    unrecorded: 0,
  });
  r = await sync(s);
  assert.equal(r.counts.processed, 110);
  assert.equal(r.hasMoreToSync, false);
  const ids = [];
  for (let p = 0; p < 5; p++) {
    const page = await readTradeEvents(s.db, s.a, p);
    ids.push(...page.events.map((e) => e.id));
    assert.deepEqual(page.counts, r.counts);
  }
  assert.equal(ids.length, 110);
  assert.equal(new Set(ids).size, 110);
});
test("late or reordered committed facts older than already processed records are collected", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 1 }), now);
  await sync(s);
  await placePractice(s.db, s.a, order({ quantity: 1 }), now - 10000);
  const r = await sync(s);
  assert.equal(r.counts.processed, 2);
  assert.ok(
    r.events.some((e) => e.occurredAt === new Date(now - 10000).toISOString()),
  );
});
test("expiry releases have correct remaining quantity and no phantom trade is created", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await practiceAccount(s.db, s.a, 0, now + 86400001);
  const r = await sync(s);
  assert.equal(r.events.find((e) => e.kind === "buy_released").quantity, 3);
  assert.equal(
    r.events.some((e) => e.kind === "buy_filled"),
    false,
  );
});
test("forged payload, account IDs, inactive users and invalid pages are rejected", async () => {
  const s = await history();
  for (const body of [
    { action: "sync", userId: "b" },
    { action: "fill" },
    { action: "sync", quantity: 100 },
  ])
    await assert.rejects(
      syncTradeEvents(s.db, s.a, body),
      (e) => e.status === 400,
    );
  for (const page of [-1, 0.1, 10001])
    await assert.rejects(
      readTradeEvents(s.db, s.a, page),
      (e) => e.status === 400,
    );
  await sync(s, s.b);
  const b = await readTradeEvents(s.db, s.b);
  assert.equal(b.events.length, 2);
  assert.ok(b.events.every((e) => e.outcome === "no"));
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(sync(s), (e) => e.status === 403);
  await assert.rejects(readTradeEvents(s.db, s.a), (e) => e.status === 403);
});
