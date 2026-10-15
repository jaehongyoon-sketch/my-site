import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  cancelPractice,
  order,
  now,
} from "./helpers/practice.mjs";
const b = await build({
  entryPoints: ["lib/notifications/service.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { readNotifications, updateNotifications } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
test("sync collects accepted/fill/release once without changing funds; reads are idempotent and private", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  const o = await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 1 }), now);
  await cancelPractice(s.db, s.a, { orderId: o.order.id }, now);
  const cash = s.sql.prepare("SELECT * FROM practice_cash").all();
  const a = await updateNotifications(s.db, s.a, { action: "sync" });
  assert.equal(a.entries.length, 3);
  assert.equal(a.unread, 3);
  assert.equal(
    (await updateNotifications(s.db, s.a, { action: "sync" })).entries.length,
    3,
  );
  assert.deepEqual(s.sql.prepare("SELECT * FROM practice_cash").all(), cash);
  assert.equal((await readNotifications(s.db, s.b)).entries.length, 0);
  await assert.rejects(
    updateNotifications(s.db, s.b, { action: "read", id: a.entries[0].id }),
    { status: 404 },
  );
  const read = await updateNotifications(s.db, s.a, {
    action: "read",
    id: a.entries[0].id,
  });
  assert.equal(read.unread, 2);
  assert.equal(
    (
      await updateNotifications(s.db, s.a, {
        action: "read",
        id: a.entries[0].id,
      })
    ).unread,
    2,
  );
});
test("settings use revisions; disabled sync suppresses permanently and new enabled records arrive", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await updateNotifications(s.db, s.a, {
    action: "settings",
    enabled: false,
    expectedRevision: 0,
  });
  await assert.rejects(
    updateNotifications(s.db, s.a, {
      action: "settings",
      enabled: true,
      expectedRevision: 0,
    }),
    { status: 409 },
  );
  await placePractice(s.db, s.a, order({ quantity: 1 }), now);
  assert.equal(
    (await updateNotifications(s.db, s.a, { action: "sync" })).entries.length,
    0,
  );
  await updateNotifications(s.db, s.a, {
    action: "settings",
    enabled: true,
    expectedRevision: 1,
  });
  assert.equal(
    (await updateNotifications(s.db, s.a, { action: "sync" })).entries.length,
    0,
  );
  await placePractice(s.db, s.a, order({ quantity: 1 }), now + 1);
  assert.equal(
    (await updateNotifications(s.db, s.a, { action: "sync" })).entries.length,
    1,
  );
});
test("invalid requests, inactive users and pagination are protected", async () => {
  const s = setup();
  await assert.rejects(readNotifications(s.db, s.a, -1), { status: 400 });
  await assert.rejects(
    updateNotifications(s.db, s.a, { action: "sync", userId: "b" }),
    { status: 400 },
  );
  s.sql.exec("UPDATE app_users SET status='closed' WHERE id='a'");
  await assert.rejects(updateNotifications(s.db, s.a, { action: "sync" }));
});
test("bounded sync can recover more than 100 records with stable pagination", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  for (let i = 0; i < 101; i++)
    await placePractice(
      s.db,
      s.a,
      order({ quantity: 1, limitPriceCents: 1 }),
      now + i,
    );
  const a = await updateNotifications(s.db, s.a, { action: "sync" });
  assert.equal(a.unread, 100);
  assert.equal(a.hasMoreToSync, true);
  const b = await updateNotifications(s.db, s.a, { action: "sync" });
  assert.equal(b.unread, 101);
  assert.equal(b.hasMoreToSync, false);
  const last = await readNotifications(s.db, s.a, 4);
  assert.equal(last.entries.length, 1);
  assert.equal(last.unread, 101);
});
