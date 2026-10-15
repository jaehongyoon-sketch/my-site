import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
const b = await build({
  entryPoints: [
    new URL("../lib/practice/service.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { startPractice, placePractice, practiceAccount } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
const now = Date.now(),
  deadline = new Date(now + 86400000).toISOString(),
  eventId = crypto.randomUUID();
const intent = (extra = {}) => ({
  eventId,
  eventRevision: 1,
  side: "buy",
  orderType: "limit",
  timeInForce: "until-close",
  outcome: "yes",
  limitPriceCents: 60,
  quantity: 100,
  ...extra,
});
const order = (extra = {}) => ({
  clientOrderId: crypto.randomUUID(),
  intent: intent(extra),
});
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"));
  for (const id of ["a", "b"])
    sql
      .prepare("INSERT INTO app_users VALUES (?,?,?,?)")
      .run(id, "google:" + id, "active", new Date(now).toISOString());
  sql
    .prepare("INSERT INTO own_events VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      eventId,
      "Will the test happen?",
      "Science",
      "A valid test rule with a published source.",
      "https://example.org",
      deadline,
      "published",
      1,
      "a",
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );
  let failLedger = false;
  const db = {
    prepare(q) {
      let args = [];
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return sql.prepare(q).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(q).all(...args) };
        },
        runSync() {
          if (/^\s*SELECT/i.test(q))
            return {
              results: sql.prepare(q).all(...args),
              meta: { changes: 0 },
            };
          if (failLedger && q.includes("':reserve'"))
            throw Error("injected ledger failure");
          return {
            meta: { changes: Number(sql.prepare(q).run(...args).changes) },
          };
        },
      };
    },
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const results = stmts.map((s) => s.runSync());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return {
    db,
    sql,
    a: { userId: "a", email: "a@example.test", displayName: "A" },
    b: { userId: "b", email: "b@example.test", displayName: "B" },
    inject: () => {
      failLedger = true;
    },
  };
}
test("practice grant is one-time even under concurrency, account reactivation and repeated requests", async () => {
  const { db, sql, a } = setup();
  await Promise.all([startPractice(db, a), startPractice(db, a)]);
  await startPractice(db, a);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_cash_entries").get().n,
    1,
  );
  assert.equal((await practiceAccount(db, a)).wallet.availableCents, 100000);
  sql.prepare("UPDATE app_users SET status='closed' WHERE id='a'").run();
  await assert.rejects(startPractice(db, a), (e) => e.status === 403);
  sql.prepare("UPDATE app_users SET status='active' WHERE id='a'").run();
  await startPractice(db, a);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_cash_entries").get().n,
    1,
  );
});
test("reserve cost plus 0.25%, durable retry and conflicting intent; real tables untouched", async () => {
  const { db, sql, a } = setup();
  await startPractice(db, a);
  const input = order(),
    r = await placePractice(db, a, input, now);
  assert.equal(r.order.heldCents, 6015);
  assert.equal(r.order.feePolicy, "per_contract");
  const r2 = await placePractice(db, a, input, now);
  assert.equal(r2.order.id, r.order.id);
  assert.equal(r2.replayed, true);
  await assert.rejects(
    placePractice(db, a, { ...input, intent: intent({ quantity: 2 }) }, now),
    (e) => e.code === "KEY_CONFLICT",
  );
  const w = (await practiceAccount(db, a)).wallet;
  assert.deepEqual(
    { ...w },
    { availableCents: 93985, reservedCents: 6015, spentCents: 0 },
  );
  assert.equal(sql.prepare("SELECT count(*) n FROM orders").get().n, 0);
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) n FROM practice_cash_entries WHERE kind='reserve'",
      )
      .get().n,
    1,
  );
});
test("concurrent duplicate submissions reserve once", async () => {
  const { db, sql, a } = setup();
  await startPractice(db, a);
  const input = order();
  const results = await Promise.all([
    placePractice(db, a, input, now),
    placePractice(db, a, input, now),
  ]);
  assert.equal(results[0].order.id, results[1].order.id);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_orders").get().n,
    1,
  );
  assert.equal((await practiceAccount(db, a)).wallet.reservedCents, 6015);
});
test("competing orders cannot spend the same available balance", async () => {
  const { db, a } = setup();
  await startPractice(db, a);
  const result = await Promise.allSettled([
    placePractice(db, a, order({ quantity: 1000 }), now),
    placePractice(db, a, order({ quantity: 1000 }), now),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await practiceAccount(db, a)).wallet.availableCents, 39850);
});
test("failed ledger insert rolls back both order and wallet reservation", async () => {
  const { db, sql, a, inject } = setup();
  await startPractice(db, a);
  inject();
  await assert.rejects(placePractice(db, a, order(), now));
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_orders").get().n,
    0,
  );
  assert.equal((await practiceAccount(db, a)).wallet.availableCents, 100000);
});
test("expired and hidden events release once with ledger balance reconciliation", async () => {
  for (const state of ["expired", "archived", "revision"]) {
    const { db, sql, a } = setup();
    await startPractice(db, a);
    await placePractice(db, a, order(), now);
    if (state === "archived")
      sql.prepare("UPDATE own_events SET status='archived'").run();
    if (state === "revision")
      sql.prepare("UPDATE own_events SET revision=2").run();
    const clock = state === "expired" ? now + 86400001 : now;
    const data = await practiceAccount(db, a, 0, clock);
    assert.equal(
      data.orders[0].status,
      state === "expired" ? "expired" : "voided",
    );
    assert.equal(data.wallet.availableCents, 100000);
    await practiceAccount(db, a, 0, clock);
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) n FROM practice_cash_entries WHERE kind='release'",
        )
        .get().n,
      1,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT sum(available_delta_units)/400.0 n FROM practice_cash_entries",
        )
        .get().n,
      100000,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT sum(reserved_delta_units)/400.0 n FROM practice_cash_entries",
        )
        .get().n,
      0,
    );
  }
});
test("accounts isolated, missing wallet blocked, forged amounts and stale or closed event rejected", async () => {
  const { db, sql, a, b } = setup();
  await assert.rejects(
    placePractice(db, a, order(), now),
    (e) => e.code === "NOT_STARTED",
  );
  await startPractice(db, a);
  await placePractice(db, a, order(), now);
  assert.equal((await practiceAccount(db, b)).orders.length, 0);
  assert.equal((await practiceAccount(db, b)).wallet, null);
  await assert.rejects(
    placePractice(db, a, { ...order(), totalCents: 1 }, now),
    (e) => e.status === 400,
  );
  await assert.rejects(
    placePractice(db, a, order({ eventRevision: 2 }), now),
    (e) => e.code === "EVENT_UNAVAILABLE",
  );
  await assert.rejects(
    placePractice(db, a, order(), now + 86400001),
    (e) => e.code === "EVENT_UNAVAILABLE",
  );
  sql.prepare("UPDATE app_users SET status='suspended' WHERE id='a'").run();
  await assert.rejects(
    placePractice(db, a, order(), now),
    (e) => e.status === 403,
  );
});
