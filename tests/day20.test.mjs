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
const { operationStatus, changeOperations, operationAudit } = await module(
  "lib/operations/service.ts",
);
const { matchEvent } = await module("lib/practice/matching.ts");
const { reserveSell } = await module("lib/practice/sells.ts");
const request = (paused = true, expectedRevision = 0) => ({
  paused,
  expectedRevision,
  requestId: crypto.randomUUID(),
  reason: "Investigating practice matching behavior.",
});
test("only active configured administrator can pause and inspect audit records", async () => {
  const s = setup();
  await assert.rejects(changeOperations(s.db, s.b, "a", request()), {
    status: 403,
  });
  await assert.rejects(operationAudit(s.db, s.b, "a", {}), { status: 403 });
  await assert.rejects(
    changeOperations(s.db, s.a, "a", { ...request(), reason: "x" }),
  );
  assert.equal((await operationStatus(s.db)).paused, false);
});
test("pause/resume receipts are durable, stale writes rejected and reasons retained", async () => {
  const s = setup(),
    r = request();
  const first = await changeOperations(s.db, s.a, "a", r);
  assert.equal(first.paused, true);
  assert.deepEqual(await changeOperations(s.db, s.a, "a", r), first);
  await assert.rejects(
    changeOperations(s.db, s.a, "a", { ...r, paused: false }),
    { status: 409 },
  );
  await assert.rejects(changeOperations(s.db, s.a, "a", request(false)), {
    status: 409,
  });
  await changeOperations(s.db, s.a, "a", request(false, 1));
  assert.equal((await operationStatus(s.db)).paused, false);
  assert.deepEqual(await changeOperations(s.db, s.a, "a", r), first);
  const log = await operationAudit(s.db, s.a, "a", {});
  assert.equal(log.entries.length, 2);
  assert.ok(log.entries.every((e) => e.reason.includes(r.reason)));
});
test("audit failure rolls back operational state", async () => {
  const s = setup();
  s.sql.exec(
    "CREATE TRIGGER fail_control BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit failure'); END",
  );
  await assert.rejects(
    changeOperations(s.db, s.a, "a", request()),
    /audit failure/,
  );
  assert.equal((await operationStatus(s.db)).revision, 0);
});
test("pause blocks new buys and matching; cancellation and reads remain available; resume restores fills", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  const o = await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await changeOperations(s.db, s.a, "a", request());
  await assert.rejects(
    placePractice(s.db, s.b, order({ outcome: "no", quantity: 2 }), now),
    { status: 403 },
  );
  await matchEvent(s.db, eventId, now);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  assert.ok(await practiceAccount(s.db, s.a));
  await cancelPractice(s.db, s.a, { orderId: o.order.id }, now);
  await changeOperations(s.db, s.a, "a", request(false, 1));
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 2 }), now);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    1,
  );
  await changeOperations(s.db, s.a, "a", request(true, 2));
  await assert.rejects(
    reserveSell(s.db, s.a, order({ side: "sell", quantity: 1 }), now),
    { status: 403 },
  );
});
test("audit filters and pagination are bounded and read-only", async () => {
  const s = setup();
  for (let i = 0; i < 27; i++)
    await changeOperations(s.db, s.a, "a", request(i % 2 === 0, i));
  const a = await operationAudit(s.db, s.a, "a", {}),
    b = await operationAudit(s.db, s.a, "a", { page: 1 });
  assert.equal(a.entries.length, 25);
  assert.equal(b.entries.length, 2);
  assert.equal(new Set([...a.entries, ...b.entries].map((e) => e.id)).size, 27);
  assert.equal(
    (await operationAudit(s.db, s.a, "a", { action: "practice.resume" }))
      .entries.length,
    13,
  );
  await assert.rejects(operationAudit(s.db, s.a, "a", { page: -1 }));
  assert.equal((await operationStatus(s.db)).revision, 27);
});
test("pause between eligibility check and transaction rejects the order without reserving funds", async () => {
  const s = setup();
  await startPractice(s.db, s.a);
  await changeOperations(s.db, s.a, "a", request(false));
  const batch = s.db.batch;
  s.db.batch = async (stmts) => {
    if (stmts.some((x) => x.query.includes("INSERT INTO practice_orders")))
      s.sql.exec("UPDATE practice_control SET paused=1");
    return batch(stmts);
  };
  const before = s.sql
    .prepare("SELECT * FROM practice_cash WHERE user_id=?")
    .get("a");
  await assert.rejects(placePractice(s.db, s.a, order(), now));
  assert.deepEqual(
    s.sql.prepare("SELECT * FROM practice_cash WHERE user_id=?").get("a"),
    before,
  );
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_orders").get().n,
    0,
  );
});
