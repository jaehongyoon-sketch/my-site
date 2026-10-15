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
const { eligibility, adminEligibility, changeRestriction } = await mod(
  "lib/eligibility/service.ts",
);
const { reserveSell, cancelSell } = await mod("lib/practice/sells.ts");
const cmd = (userId = "a", extra = {}) => ({
  userId,
  blocked: true,
  expectedRevision: 0,
  requestId: crypto.randomUUID(),
  reason: "Account review required",
  ...extra,
});
async function funded() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  return s;
}
test("login/profile verification is separate from identity and real trading eligibility", async () => {
  const s = setup();
  const e = await eligibility(s.db, s.a);
  assert.equal(e.practiceAllowed, true);
  assert.equal(e.liveTradingAllowed, false);
  assert.equal(e.identityVerification, "not_connected");
  assert.equal(e.locationVerification, "not_connected");
  const missing = await eligibility(s.db, { userId: "missing" });
  assert.equal(missing.practiceAllowed, false);
  assert.equal(missing.profile, "missing");
  s.sql.exec("UPDATE app_users SET status='closed' WHERE id='a'");
  assert.equal((await eligibility(s.db, s.a)).practiceAllowed, false);
});
test("only configured active admin can change or list restrictions and no approval field is accepted", async () => {
  const s = setup();
  await assert.rejects(
    changeRestriction(s.db, s.b, "a", cmd()),
    (e) => e.status === 403,
  );
  await assert.rejects(
    adminEligibility(s.db, s.a, undefined),
    (e) => e.status === 403,
  );
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", { ...cmd(), verified: true }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", cmd("a", { reason: "short" })),
    (e) => e.status === 400,
  );
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", cmd()),
    (e) => e.status === 403,
  );
});
test("changes and audit commit together; stale edits and conflicting retry cannot mutate", async () => {
  const s = setup(),
    p = cmd();
  await changeRestriction(s.db, s.a, "a", p);
  await changeRestriction(s.db, s.a, "a", p);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM audit_entries").get().n,
    1,
  );
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", cmd("a", { blocked: false })),
    (e) => e.status === 409,
  );
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", {
      ...p,
      blocked: false,
      expectedRevision: 1,
    }),
    (e) => e.status === 409,
  );
  assert.equal((await eligibility(s.db, s.a)).tradingRestricted, true);
  await changeRestriction(
    s.db,
    s.a,
    "a",
    cmd("a", { blocked: false, expectedRevision: 1 }),
  );
  assert.equal((await eligibility(s.db, s.a)).practiceAllowed, true);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM audit_entries").get().n,
    2,
  );
  assert.equal((await eligibility(s.db, s.a)).liveTradingAllowed, false);
});
test("audit failure rolls back restriction and concurrent revisions admit one change", async () => {
  const s = setup();
  s.sql.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  await assert.rejects(
    changeRestriction(s.db, s.a, "a", cmd()),
    /audit unavailable/,
  );
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM trading_restrictions").get().n,
    0,
  );
  s.sql.exec("DROP TRIGGER reject_audit");
  const results = await Promise.allSettled([
    changeRestriction(s.db, s.a, "a", cmd()),
    changeRestriction(s.db, s.a, "a", cmd("a", { blocked: false })),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("restriction blocks new buys and matching, retains cash, allows cancel; removal restores practice", async () => {
  const s = await funded();
  const a = await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await changeRestriction(s.db, s.a, "a", cmd());
  await assert.rejects(
    placePractice(s.db, s.a, order({ quantity: 1 }), now),
    (e) => e.status === 403,
  );
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 2 }), now);
  assert.equal((await practiceAccount(s.db, s.a)).fills.length, 0);
  assert.equal((await practiceAccount(s.db, s.a)).wallet.reservedCents, 120.3);
  await cancelPractice(s.db, s.a, { orderId: a.order.id }, now);
  assert.equal((await practiceAccount(s.db, s.a)).wallet.reservedCents, 0);
  await changeRestriction(
    s.db,
    s.a,
    "a",
    cmd("a", { blocked: false, expectedRevision: 1 }),
  );
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  assert.equal((await practiceAccount(s.db, s.a)).fills.length, 1);
});
test("restricted holder cannot create new sell reservation but can cancel old reservation", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 3 }), now);
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 3 }), now);
  const sale = await reserveSell(
    s.db,
    s.a,
    order({ side: "sell", quantity: 1 }),
    now,
  );
  await changeRestriction(s.db, s.a, "a", cmd());
  await assert.rejects(
    reserveSell(s.db, s.a, order({ side: "sell", quantity: 1 }), now),
    (e) => e.status === 403,
  );
  await cancelSell(s.db, s.a, { orderId: sale.order.id }, now);
  assert.equal(
    (await practiceAccount(s.db, s.a)).positions[0].availableQuantity,
    3,
  );
});
test("restriction arriving after match selection is rechecked at atomic commit", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  let blocked = false;
  const wrapped = {
    ...s.db,
    prepare(q) {
      const stmt = s.db.prepare(q),
        original = stmt.first;
      stmt.first = async () => {
        const row = await original.call(stmt);
        if (!blocked && q.includes("makerPolicy") && row) {
          blocked = true;
          await changeRestriction(s.db, s.a, "a", cmd());
        }
        return row;
      };
      return stmt;
    },
  };
  await placePractice(wrapped, s.b, order({ outcome: "no", quantity: 2 }), now);
  assert.equal(blocked, true);
  assert.equal((await practiceAccount(s.db, s.a)).fills.length, 0);
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_match_entries").get().n,
    0,
  );
});
test("user eligibility does not expose admin reason or others; listing and audit remain admin only", async () => {
  const s = setup();
  await changeRestriction(
    s.db,
    s.a,
    "a",
    cmd("b", { reason: "Internal operational review" }),
  );
  const e = await eligibility(s.db, s.b);
  assert.equal(e.tradingRestricted, true);
  assert.equal(JSON.stringify(e).includes("Internal operational"), false);
  assert.equal((await eligibility(s.db, s.a)).tradingRestricted, false);
  const a = await adminEligibility(s.db, s.a, "a");
  assert.equal(a.history.length, 1);
  assert.equal(a.accounts.find((x) => x.id === "b").revision, 1);
  await assert.rejects(
    adminEligibility(s.db, s.b, "a"),
    (e) => e.status === 403,
  );
  await assert.rejects(
    adminEligibility(s.db, s.a, "a", -1),
    (e) => e.status === 400,
  );
});
