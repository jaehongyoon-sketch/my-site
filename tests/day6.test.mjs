import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  providerAccess,
  getProviderControls,
  reviewProvider,
} from "../lib/providers/control.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"));
  for (const id of ["admin", "member"])
    sql
      .prepare("INSERT INTO app_users VALUES (?,?,?,?)")
      .run(id, "google:" + id, "active", "2026-09-27");
  const db = {
    prepare(query) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          const r = sql.prepare(query).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sql, admin: { userId: "admin" }, member: { userId: "member" } };
}
const review = (overrides = {}) => ({
  connectionId: "kalshi:sandbox",
  approval: "testing",
  expectedRevision: 0,
  note: "Sandbox review started",
  evidence: "",
  ...overrides,
});
test("missing configurations default to unapproved and never mutate on GET", async () => {
  const { db, sql, admin } = setup();
  const data = await getProviderControls(db, admin, "admin");
  assert.equal(data.connections.length, 2);
  assert.ok(
    data.connections.every(
      (c) =>
        c.approval === "unapproved" &&
        c.revision === 0 &&
        !c.marketData.allowed &&
        !c.orders.allowed,
    ),
  );
  assert.equal(
    sql.prepare("SELECT count(*) AS n FROM provider_connections").get().n,
    0,
  );
});
test("members, inactive and missing configured administrator cannot inspect or mutate", async () => {
  const { db, sql, admin, member } = setup();
  for (const [identity, configured] of [
    [member, "admin"],
    [admin, undefined],
  ]) {
    await assert.rejects(getProviderControls(db, identity, configured), {
      status: 403,
    });
    await assert.rejects(reviewProvider(db, identity, configured, review()), {
      status: 403,
    });
  }
  for (const status of ["closed", "suspended"]) {
    sql
      .prepare("UPDATE app_users SET status=? WHERE id=?")
      .run(status, "admin");
    await assert.rejects(reviewProvider(db, admin, "admin", review()), {
      status: 403,
    });
  }
});
test("save persists approval and an attributable audit entry atomically", async () => {
  const { db, admin } = setup();
  await reviewProvider(db, admin, "admin", review());
  const data = await getProviderControls(db, admin, "admin");
  assert.equal(data.connections[0].approval, "testing");
  assert.equal(data.connections[0].revision, 1);
  assert.equal(data.history[0].actorId, "admin");
  assert.deepEqual(JSON.parse(data.history[0].reason), {
    from: "unapproved",
    to: "testing",
    note: "Sandbox review started",
    evidence: "",
    revision: 1,
  });
  assert.equal(data.connections[1].approval, "unapproved");
});
test("stale revisions and repeated requests cannot overwrite newer reviews", async () => {
  const { db, admin } = setup();
  await reviewProvider(db, admin, "admin", review());
  await assert.rejects(
    reviewProvider(db, admin, "admin", review({ approval: "suspended" })),
    { status: 409 },
  );
  const data = await reviewProvider(
    db,
    admin,
    "admin",
    review({ expectedRevision: 1, approval: "suspended" }),
  );
  assert.equal(data.connections[0].revision, 2);
  assert.equal(data.connections[0].approval, "suspended");
  assert.equal(data.history.length, 2);
});
test("approval requires evidence; live testing, unknown providers and malformed updates are rejected", async () => {
  const { db, admin } = setup();
  for (const changes of [
    { approval: "approved" },
    { connectionId: "kalshi:live" },
    { connectionId: "other:live" },
    { note: "x" },
    { expectedRevision: -1 },
    { approval: "hacked" },
  ])
    await assert.rejects(reviewProvider(db, admin, "admin", review(changes)), {
      status: 400,
    });
  const data = await reviewProvider(
    db,
    admin,
    "admin",
    review({
      connectionId: "kalshi:live",
      approval: "approved",
      evidence: "Test approval reference only",
    }),
  );
  assert.equal(data.connections[1].approval, "approved");
  assert.equal(data.connections[1].orders.allowed, false);
  assert.equal(data.connections[1].marketData.allowed, false);
});
test("audit failure rolls back initialization and status changes", async () => {
  const { db, sql, admin } = setup();
  sql.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  await assert.rejects(
    reviewProvider(db, admin, "admin", review()),
    /audit unavailable/,
  );
  assert.equal(
    sql.prepare("SELECT count(*) AS n FROM provider_connections").get().n,
    0,
  );
});
test("capability gates fail closed for all external statuses and environments", () => {
  for (const environment of ["sandbox", "live", "development", "unknown"])
    for (const approval of [
      "unapproved",
      "testing",
      "approved",
      "suspended",
      "unknown",
    ])
      for (const capability of ["marketData", "orders"])
        assert.equal(
          providerAccess("kalshi", environment, approval, capability).allowed,
          false,
        );
  assert.equal(
    providerAccess("unknown", "live", "approved", "marketData").allowed,
    false,
  );
  assert.equal(
    providerAccess("demo", "development", "approved", "orders").allowed,
    false,
  );
  assert.equal(
    providerAccess("demo", "live", "approved", "marketData").allowed,
    false,
  );
  assert.equal(
    providerAccess("demo", "development", "approved", "marketData").allowed,
    true,
  );
});
