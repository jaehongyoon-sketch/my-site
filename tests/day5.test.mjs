import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  isAdministrator,
  listWatchlist,
  setWatchlist,
  getAdminAccounts,
} from "../lib/accounts/access.ts";
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"),
    );
  for (const id of ["a", "b"]) {
    sqlite
      .prepare("INSERT INTO app_users VALUES (?,?,?,?)")
      .run(id, "google:" + id, "active", "2026-09-27T00:00:00Z");
    sqlite
      .prepare("INSERT INTO app_profiles VALUES (?,?,?)")
      .run(id, id.toUpperCase(), "2026-09-27T00:00:00Z");
  }
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args) };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
  return {
    db,
    sqlite,
    a: { userId: "a", email: "same@example.test", displayName: "A" },
    b: { userId: "b", email: "same@example.test", displayName: "B" },
  };
}
test("only the configured active account is administrator", () => {
  assert.equal(isAdministrator({ id: "a", status: "active" }, "a"), true);
  for (const status of ["closed", "suspended"])
    assert.equal(isAdministrator({ id: "a", status }, "a"), false);
  assert.equal(isAdministrator({ id: "b", status: "active" }, "a"), false);
  assert.equal(
    isAdministrator({ id: "a", status: "active" }, undefined),
    false,
  );
});
test("watchlists persist separately even when emails match", async () => {
  const { db, a, b } = setup();
  await setWatchlist(db, a, "market-a", true);
  await setWatchlist(db, b, "market-b", true);
  assert.deepEqual(await listWatchlist(db, a), ["market-a"]);
  assert.deepEqual(await listWatchlist(db, b), ["market-b"]);
  await setWatchlist(db, b, "market-a", false);
  assert.deepEqual(await listWatchlist(db, a), ["market-a"]);
});
test("retries are idempotent for save and remove", async () => {
  const { db, a } = setup();
  await setWatchlist(db, a, "m", true);
  await setWatchlist(db, a, "m", true);
  assert.deepEqual(await listWatchlist(db, a), ["m"]);
  await setWatchlist(db, a, "m", false);
  await setWatchlist(db, a, "m", false);
  assert.deepEqual(await listWatchlist(db, a), []);
});
test("closed, suspended and unregistered accounts cannot read or change watchlists", async () => {
  const { db, sqlite, a } = setup();
  for (const status of ["closed", "suspended"]) {
    sqlite.prepare("UPDATE app_users SET status=? WHERE id=?").run(status, "a");
    await assert.rejects(listWatchlist(db, a), { status: 403 });
    await assert.rejects(setWatchlist(db, a, "m", true), { status: 403 });
  }
  await assert.rejects(listWatchlist(db, { ...a, userId: "absent" }), {
    status: 403,
  });
});
test("members cannot read admin data or grant themselves privileges", async () => {
  const { db, a, b } = setup();
  await assert.rejects(getAdminAccounts(db, b, "a"), { status: 403 });
  await assert.rejects(getAdminAccounts(db, a, undefined), { status: 403 });
});
test("admin view counts only unexpired sessions and never exposes authentication material", async () => {
  const { db, sqlite, a } = setup();
  const now = Date.now();
  for (const [id, expiry] of [
    ["live", now + 60000],
    ["expired", now - 1],
  ])
    sqlite
      .prepare("INSERT INTO google_sessions VALUES (?,?,?,?,?)")
      .run(id, "a", "private@example.test", "Name", expiry);
  const result = await getAdminAccounts(db, a, "a");
  const admin = result.accounts.find((r) => r.id === "a");
  assert.equal(admin.sessions, 1);
  assert.equal(admin.role, "admin");
  assert.equal(result.totals.accounts, 2);
  for (const key of ["auth_subject", "google_subject", "token_hash", "email"])
    assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(result).includes("private@example.test"), false);
});
test("admin pagination is bounded and deterministic", async () => {
  const { db, a } = setup();
  await assert.rejects(getAdminAccounts(db, a, "a", -1), { status: 400 });
  await assert.rejects(getAdminAccounts(db, a, "a", 1.5), { status: 400 });
  assert.equal((await getAdminAccounts(db, a, "a", 1)).accounts.length, 0);
});
