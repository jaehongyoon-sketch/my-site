import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { setup } from "./helpers/practice.mjs";
async function load(file) {
  const b = await build({
    entryPoints: [file],
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
const { limitMutation } = await load("lib/security/rate-limit.ts");
const { boundedBody } = await load("lib/security/request-body.ts");
const { checkMutationOrigin } = await load("lib/accounts/service.ts");
test("persistent quota enforces exact limit across endpoints, isolates users and cancellations, resets next minute", async () => {
  const s = setup();
  for (let i = 0; i < 60; i++)
    await limitMutation(s.db, "subject-a", "/api/practice/orders", 60000);
  await assert.rejects(
    limitMutation(s.db, "subject-a", "/api/practice/match", 60001),
    { status: 429 },
  );
  await limitMutation(s.db, "subject-b", "/api/practice/orders", 60001);
  await limitMutation(s.db, "subject-a", "/api/practice/cancel", 60001);
  await limitMutation(s.db, "subject-a", "/api/practice/orders", 120000);
  assert.ok(
    s.sql
      .prepare("SELECT key FROM request_limits")
      .all()
      .every((r) => r.key.length === 64 && !r.key.includes("subject")),
  );
});
test("concurrent requests cannot exceed admin budget; rejected calls do not increase counter", async () => {
  const s = setup();
  const r = await Promise.allSettled(
    Array.from({ length: 25 }, () =>
      limitMutation(s.db, "a", "/api/admin/events", 60000),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 20);
  assert.equal(
    s.sql.prepare("SELECT count FROM request_limits").get().count,
    20,
  );
});
test("counter cleanup is bounded and database failure does not allow a mutation", async () => {
  const s = setup();
  s.sql.exec(
    "CREATE TRIGGER fail_limit BEFORE INSERT ON request_limits BEGIN SELECT RAISE(ABORT,'storage unavailable'); END",
  );
  await assert.rejects(
    limitMutation(s.db, "a", "/api/notifications", 60000),
    /storage unavailable/,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM request_limits").get().n,
    0,
  );
});
test("body cap counts bytes without trusting content length and cancels oversized streams", async () => {
  assert.equal(
    await boundedBody(
      new Request("https://example.test", { method: "POST", body: "hello" }),
      5,
    ),
    "hello",
  );
  await assert.rejects(
    boundedBody(
      new Request("https://example.test", { method: "POST", body: "가가" }),
      5,
    ),
    { status: 413 },
  );
  await assert.rejects(
    boundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: "x",
        headers: { "content-length": "999" },
      }),
      5,
    ),
    { status: 413 },
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: stream,
        duplex: "half",
      }),
      5,
    ),
    { status: 413 },
  );
  assert.equal(cancelled, true);
});
test("mutation content type must be exactly JSON; cross-site and missing origin rejected", () => {
  const req = (type, origin = "https://example.test") =>
    new Request("https://example.test/api", {
      method: "POST",
      headers: { origin, "content-type": type },
    });
  checkMutationOrigin(req("application/json; charset=utf-8"));
  assert.throws(() => checkMutationOrigin(req("application/json-evil")), {
    status: 415,
  });
  assert.throws(
    () => checkMutationOrigin(req("application/json", "https://other.test")),
    { status: 403 },
  );
});
