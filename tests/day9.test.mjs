import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
const bundled = await build({
  entryPoints: [new URL("../lib/orders/preview.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { previewOrder } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const eventId = "d5b095c1-f1b1-4b02-81c9-f1a92aaf0691";
const now = Date.parse("2026-09-27T12:00:00Z");
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
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"));
  sql
    .prepare("INSERT INTO app_users VALUES (?,?,?,?)")
    .run("a", "google:a", "active", new Date(now).toISOString());
  sql
    .prepare("INSERT INTO own_events VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      eventId,
      "Will this test event happen?",
      "Science",
      "YES if confirmed; otherwise NO according to the source.",
      "https://example.org",
      "2026-09-28T00:00:00.000Z",
      "published",
      1,
      "a",
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );
  const db = {
    prepare(q) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async first() {
          return sql.prepare(q).get(...args) ?? null;
        },
      };
    },
  };
  return {
    db,
    sql,
    a: { userId: "a", email: "a@example.test", displayName: "A" },
  };
}
test("preview recomputes totals and 0.25% fee without writing orders or implying buying power", async () => {
  const { db, sql, a } = setup();
  const p = await previewOrder(db, a, intent(), now);
  assert.equal(p.calculation.principalCents, 6000);
  assert.equal(p.calculation.feeCents, 15);
  assert.equal(p.calculation.totalCents, 6015);
  assert.equal(p.calculation.payoutCents, 10000);
  assert.equal(p.calculation.netProfitCents, 3985);
  assert.equal(p.executable, false);
  assert.equal(p.priceBasis, "user_limit");
  assert.equal(p.checks.balance, "not_connected");
  assert.equal(p.checks.execution, "not_connected");
  assert.equal(p.expiresAt, new Date(now + 60000).toISOString());
  assert.equal(sql.prepare("SELECT count(*) n FROM orders").get().n, 0);
});
test("strict input rejects forged totals, identities, environment and unsupported order types", async () => {
  const { db, a } = setup();
  for (const bad of [
    { feeCents: 0 },
    { totalCents: 1 },
    { userId: "b" },
    { accountId: "b" },
    { environment: "live" },
    { side: "sell" },
    { orderType: "market" },
    { timeInForce: "forever" },
    { outcome: "maybe" },
    { quantity: "100" },
    { limitPriceCents: "60" },
    { limitPriceCents: 0 },
    { limitPriceCents: 100 },
    { limitPriceCents: 1.5 },
    { quantity: 0 },
    { quantity: 10001 },
    { quantity: 1.5 },
    { eventRevision: 0 },
  ])
    await assert.rejects(previewOrder(db, a, intent(bad), now), {
      status: 400,
      code: "INVALID_ORDER_INTENT",
    });
});
test("closed, suspended and missing profiles cannot review; client email cannot grant access", async () => {
  const { db, sql, a } = setup();
  for (const status of ["closed", "suspended"]) {
    sql.prepare("UPDATE app_users SET status=?").run(status);
    await assert.rejects(previewOrder(db, a, intent(), now), { status: 403 });
  }
  await assert.rejects(
    previewOrder(db, { ...a, userId: "other" }, intent(), now),
    { status: 403 },
  );
});
test("drafts and archived events stay unavailable and changed revisions require a reload", async () => {
  const { db, sql, a } = setup();
  for (const status of ["draft", "archived"]) {
    sql.prepare("UPDATE own_events SET status=?").run(status);
    await assert.rejects(previewOrder(db, a, intent(), now), { status: 404 });
  }
  sql.exec("UPDATE own_events SET status='published',revision=2");
  await assert.rejects(previewOrder(db, a, intent(), now), {
    status: 409,
    code: "EVENT_CHANGED",
  });
});
test("preview expires no later than closing time and exact closing boundary is denied", async () => {
  const { db, sql, a } = setup();
  sql
    .prepare("UPDATE own_events SET closes_at=?")
    .run(new Date(now + 2000).toISOString());
  const p = await previewOrder(db, a, intent(), now);
  assert.equal(p.expiresAt, new Date(now + 2000).toISOString());
  await assert.rejects(previewOrder(db, a, intent(), now + 2000), {
    status: 409,
    code: "EVENT_CLOSED",
  });
});
test("YES and NO use the requested limit; sub-cent fees and maximum amounts are exact", async () => {
  const { db, a } = setup();
  assert.equal(
    (
      await previewOrder(
        db,
        a,
        intent({ outcome: "no", limitPriceCents: 1, quantity: 200 }),
        now,
      )
    ).calculation.feeCents,
    0.5,
  );
  const p = await previewOrder(
    db,
    a,
    intent({ limitPriceCents: 99, quantity: 10000 }),
    now,
  );
  assert.equal(p.calculation.principalCents, 990000);
  assert.equal(p.calculation.feeCents, 2475);
  assert.equal(p.calculation.totalCents, 992475);
});
