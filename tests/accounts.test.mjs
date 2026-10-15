import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  createAccount,
  readAccount,
  updateAccount,
  deactivateAccount,
  reactivateAccount,
  checkMutationOrigin,
} from "../lib/accounts/service.ts";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"),
    );
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
        async run() {
          const r = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const a = { userId: "a", email: "a@example.test", displayName: "A" },
    b = { userId: "b", email: "b@example.test", displayName: "B" };
  return { db, sqlite, a, b };
}
test("registration persists a single account across retries and reads", async () => {
  const { db, a } = fixture();
  const first = await createAccount(db, a, { displayName: " Alice " });
  assert.equal(first.displayName, "Alice");
  const again = await createAccount(db, a, {
    displayName: "Unintended replacement",
  });
  assert.equal(again.id, first.id);
  assert.equal(again.displayName, "Alice");
  assert.deepEqual(await readAccount(db, a), again);
});
test("profile updates and deactivation only affect the authenticated user", async () => {
  const { db, a, b } = fixture();
  await createAccount(db, a, { displayName: "Alice" });
  await createAccount(db, b, { displayName: "Bob" });
  await updateAccount(db, a, { displayName: "Changed" });
  assert.equal((await readAccount(db, b)).displayName, "Bob");
  await deactivateAccount(db, a);
  assert.equal((await readAccount(db, a)).status, "closed");
  assert.equal((await readAccount(db, a)).displayName, "");
  assert.equal((await readAccount(db, b)).status, "active");
});
test("closed accounts cannot be silently registered or updated; explicit reactivation retains identity", async () => {
  const { db, a } = fixture();
  const original = await createAccount(db, a, { displayName: "Alice" });
  await deactivateAccount(db, a);
  await assert.rejects(createAccount(db, a, { displayName: "Alice" }), {
    status: 409,
  });
  await assert.rejects(updateAccount(db, a, { displayName: "Alice" }), {
    status: 409,
  });
  const active = await reactivateAccount(db, a, { displayName: "Return" });
  assert.equal(active.id, original.id);
  assert.equal(active.status, "active");
});
test("suspended users cannot restore privileges", async () => {
  const { db, sqlite, a } = fixture();
  await createAccount(db, a, { displayName: "Alice" });
  sqlite.exec("UPDATE app_users SET status='suspended'");
  await assert.rejects(reactivateAccount(db, a, { displayName: "Bypass" }), {
    status: 409,
  });
  await assert.rejects(updateAccount(db, a, { displayName: "Bypass" }), {
    status: 409,
  });
  await deactivateAccount(db, a);
  assert.equal((await readAccount(db, a)).status, "suspended");
});
test("client identity fields and invalid profile names are rejected", async () => {
  const { db, a } = fixture();
  for (const input of [
    { displayName: "" },
    { displayName: " " },
    { displayName: "x".repeat(61) },
    { displayName: "Alice", userId: "b" },
    { displayName: "bad\u0000name" },
  ])
    await assert.rejects(createAccount(db, a, input));
  assert.equal(await readAccount(db, a), null);
});
test("foreign and missing origins cannot mutate profiles", () => {
  const request = (origin, site = "same-origin") =>
    new Request("https://event.example/api/account", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        "content-type": "application/json",
        "sec-fetch-site": site,
      },
    });
  assert.doesNotThrow(() =>
    checkMutationOrigin(request("https://event.example")),
  );
  for (const r of [
    request(null),
    request("https://evil.example"),
    request("https://event.example", "cross-site"),
  ])
    assert.throws(() => checkMutationOrigin(r), { status: 403 });
});
