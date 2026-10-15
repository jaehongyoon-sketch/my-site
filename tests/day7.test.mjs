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
  NAME_CHANGE_INTERVAL,
} from "../lib/accounts/service.ts";
import {
  listOwnEvents,
  getOwnEvent,
  saveOwnEvent,
  deleteOwnDraft,
} from "../lib/events/service.ts";
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"));
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
        async all() {
          return { results: sql.prepare(q).all(...args) };
        },
        async run() {
          const r = sql.prepare(q).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
    async batch(ss) {
      sql.exec("BEGIN");
      try {
        const r = [];
        for (const s of ss) r.push(await s.run());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return {
    sql,
    db,
    a: { userId: "a", email: "a@example.test", displayName: "Alice" },
    b: { userId: "b", email: "b@example.test", displayName: "Bob" },
  };
}
const time = 1800000000000;
test("name cooldown starts on first change, unchanged saves do not extend it, exact 7 days unlock", async () => {
  const { db, a } = setup();
  await createAccount(db, a, { displayName: "Alice" });
  assert.equal((await readAccount(db, a)).nameChangedAt, null);
  await updateAccount(db, a, { displayName: "First" }, undefined, time);
  await updateAccount(db, a, { displayName: " First " }, undefined, time + 10);
  assert.equal((await readAccount(db, a)).nameChangedAt, time);
  await assert.rejects(
    updateAccount(
      db,
      a,
      { displayName: "Second" },
      undefined,
      time + NAME_CHANGE_INTERVAL - 1,
    ),
    { status: 429 },
  );
  await updateAccount(
    db,
    a,
    { displayName: "Second" },
    undefined,
    time + NAME_CHANGE_INTERVAL,
  );
  assert.equal((await readAccount(db, a)).displayName, "Second");
});
test("admin exemption is matched to server configured account id; users remain isolated", async () => {
  const { db, a, b } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  await createAccount(db, b, { displayName: "Bob" });
  await updateAccount(db, a, { displayName: "Admin1" }, admin.id, time);
  await updateAccount(db, a, { displayName: "Admin2" }, admin.id, time + 1);
  await updateAccount(db, b, { displayName: "Member1" }, admin.id, time);
  await assert.rejects(
    updateAccount(db, b, { displayName: "Member2" }, admin.id, time + 1),
    { status: 429 },
  );
  await assert.rejects(
    updateAccount(
      db,
      b,
      { displayName: "x", adminId: admin.id },
      admin.id,
      time + 1,
    ),
  );
});
test("reactivation cannot bypass cooldown or update an already-active profile", async () => {
  const { db, a } = setup();
  await createAccount(db, a, { displayName: "Alice" });
  await updateAccount(db, a, { displayName: "First" }, undefined, time);
  await assert.rejects(
    reactivateAccount(db, a, { displayName: "Bypass" }, undefined, time + 1),
    { status: 409 },
  );
  await deactivateAccount(db, a);
  await assert.rejects(
    reactivateAccount(db, a, { displayName: "Bypass" }, undefined, time + 1),
    { status: 429 },
  );
  assert.equal((await readAccount(db, a)).status, "closed");
  await reactivateAccount(db, a, { displayName: "First" }, undefined, time + 1);
  assert.equal((await readAccount(db, a)).nameChangedAt, time);
  await assert.rejects(
    updateAccount(db, a, { displayName: "Another" }, undefined, time + 2),
    { status: 429 },
  );
});
const event = (changes = {}) => ({
  id: crypto.randomUUID(),
  revision: 0,
  title: "Will the specified event happen?",
  category: "Science",
  rules:
    "YES if the official source confirms the event before the closing time; otherwise NO.",
  sourceUrl: "https://example.org/results",
  closesAt: "2099-01-01T00:00:00.000Z",
  status: "draft",
  ...changes,
});
test("only administrator can create; drafts are private and publication locks terms", async () => {
  const { db, a, b } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  await createAccount(db, b, { displayName: "Bob" });
  const input = event();
  await assert.rejects(saveOwnEvent(db, b, admin.id, input), { status: 403 });
  await saveOwnEvent(db, a, admin.id, input);
  assert.equal(await getOwnEvent(db, input.id), null);
  assert.equal((await listOwnEvents(db)).events.length, 0);
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 1,
    status: "published",
  });
  assert.equal((await getOwnEvent(db, input.id)).revision, 2);
  await assert.rejects(
    saveOwnEvent(db, a, admin.id, {
      ...input,
      revision: 2,
      status: "published",
      title: "Changed published question",
    }),
    { status: 409 },
  );
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 2,
    status: "archived",
    title: "Must not alter published title",
  });
  assert.equal(await getOwnEvent(db, input.id), null);
  const items = await listOwnEvents(db, {}, true);
  assert.equal(items.events[0].title, input.title);
});
test("stale edits and repeated creations are rejected; audit failure rolls back", async () => {
  const { db, sql, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  const input = event();
  await saveOwnEvent(db, a, admin.id, input);
  await assert.rejects(saveOwnEvent(db, a, admin.id, input), { status: 409 });
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 1,
    title: "Edited draft question",
  });
  await assert.rejects(
    saveOwnEvent(db, a, admin.id, { ...input, revision: 1 }),
    { status: 409 },
  );
  sql.exec(
    "CREATE TRIGGER fail_event_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  const other = event();
  await assert.rejects(
    saveOwnEvent(db, a, admin.id, other),
    /audit unavailable/,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM own_events WHERE id=?").get(other.id).n,
    0,
  );
});
test("catalog paginates, escapes search wildcards, separates expired events and filters saved ids", async () => {
  const { db, sql, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  for (let i = 0; i < 14; i++)
    await saveOwnEvent(
      db,
      a,
      admin.id,
      event({ title: `Event question number ${i}`, status: "published" }),
    );
  const p0 = await listOwnEvents(db);
  const p1 = await listOwnEvents(db, { page: 1 });
  assert.equal(p0.events.length, 12);
  assert.equal(p1.events.length, 2);
  assert.equal(p0.hasMore, true);
  assert.equal(p1.hasMore, false);
  assert.equal(new Set([...p0.events, ...p1.events].map((e) => e.id)).size, 14);
  assert.equal((await listOwnEvents(db, { q: "%" })).events.length, 0);
  assert.equal((await listOwnEvents(db, { q: "number 13" })).events.length, 1);
  const id = p0.events[0].id;
  sql
    .prepare("INSERT INTO watchlist_entries VALUES (?,?,?)")
    .run(admin.id, id, "2026-09-27");
  assert.equal(
    (await listOwnEvents(db, { savedUserId: admin.id })).events.length,
    1,
  );
  sql
    .prepare("UPDATE own_events SET closes_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", id);
  assert.equal(
    (await listOwnEvents(db, { status: "closed" })).events[0].id,
    id,
  );
  assert.ok(!(await listOwnEvents(db)).events.some((e) => e.id === id));
});
test("invalid filters, unsafe sources, expired publication and forged owner fields fail", async () => {
  const { db, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  for (const input of [
    event({ sourceUrl: "javascript:alert(1)" }),
    event({ status: "published", closesAt: "2000-01-01T00:00:00.000Z" }),
    { ...event(), updatedBy: "fake" },
  ])
    await assert.rejects(saveOwnEvent(db, a, admin.id, input));
  for (const options of [
    { page: -1 },
    { status: "draft" },
    { q: "x".repeat(101) },
    { category: "fake" },
  ])
    await assert.rejects(listOwnEvents(db, options), { status: 400 });
});

test("archived events can be republished without changing terms; original expired deadline cannot be bypassed", async () => {
  const { db, sql, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  const input = event({ status: "published" });
  await saveOwnEvent(db, a, admin.id, input);
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 1,
    status: "archived",
  });
  assert.equal(await getOwnEvent(db, input.id), null);
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 2,
    title: "Tampered restored question",
    closesAt: "2099-12-01T00:00:00.000Z",
  });
  const restored = await getOwnEvent(db, input.id);
  assert.equal(restored.title, input.title);
  assert.equal(restored.closesAt, input.closesAt);
  assert.ok((await listOwnEvents(db)).events.some((e) => e.id === input.id));
  await assert.rejects(
    saveOwnEvent(db, a, admin.id, { ...input, revision: 2 }),
    { status: 409 },
  );
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 3,
    status: "archived",
  });
  sql
    .prepare("UPDATE own_events SET closes_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", input.id);
  await assert.rejects(
    saveOwnEvent(db, a, admin.id, {
      ...input,
      revision: 4,
      closesAt: "2099-12-01T00:00:00.000Z",
    }),
    { status: 409 },
  );
  assert.equal(await getOwnEvent(db, input.id), null);
});

test("draft deletion requires administrator, exact revision and explicit acknowledgement", async () => {
  const { db, sql, a, b } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  await createAccount(db, b, { displayName: "Bob" });
  const input = event();
  await saveOwnEvent(db, a, admin.id, input);
  const del = { id: input.id, revision: 1, acknowledgement: "DELETE_DRAFT" };
  await assert.rejects(deleteOwnDraft(db, b, admin.id, del), { status: 403 });
  await assert.rejects(
    deleteOwnDraft(db, a, admin.id, { ...del, revision: 2 }),
    { status: 409 },
  );
  await assert.rejects(
    deleteOwnDraft(db, a, admin.id, { ...del, acknowledgement: "yes" }),
  );
  await deleteOwnDraft(db, a, admin.id, del);
  assert.equal((await listOwnEvents(db, {}, true)).events.length, 0);
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) n FROM audit_entries WHERE action='event.delete'",
      )
      .get().n,
    1,
  );
  await assert.rejects(deleteOwnDraft(db, a, admin.id, del), { status: 409 });
});
test("published and archived events cannot be permanently deleted", async () => {
  const { db, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  const input = event({ status: "published" });
  await saveOwnEvent(db, a, admin.id, input);
  await assert.rejects(
    deleteOwnDraft(db, a, admin.id, {
      id: input.id,
      revision: 1,
      acknowledgement: "DELETE_DRAFT",
    }),
    { status: 409 },
  );
  await saveOwnEvent(db, a, admin.id, {
    ...input,
    revision: 1,
    status: "archived",
  });
  await assert.rejects(
    deleteOwnDraft(db, a, admin.id, {
      id: input.id,
      revision: 2,
      acknowledgement: "DELETE_DRAFT",
    }),
    { status: 409 },
  );
});
test("deletion audit failure keeps the original draft", async () => {
  const { db, sql, a } = setup();
  const admin = await createAccount(db, a, { displayName: "Alice" });
  const input = event();
  await saveOwnEvent(db, a, admin.id, input);
  sql.exec(
    "CREATE TRIGGER fail_delete_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  await assert.rejects(
    deleteOwnDraft(db, a, admin.id, {
      id: input.id,
      revision: 1,
      acknowledgement: "DELETE_DRAFT",
    }),
    /audit unavailable/,
  );
  assert.equal((await listOwnEvents(db, {}, true)).events.length, 1);
});
