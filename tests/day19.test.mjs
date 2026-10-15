import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  practiceAccount,
  now,
  eventId,
  order,
} from "./helpers/practice.mjs";
const b = await build({
  entryPoints: ["lib/resolutions/service.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { saveResolution, listResolutions, publicResolution, settlementPreview } =
  await import(
    "data:text/javascript;base64," +
      Buffer.from(b.outputFiles[0].text).toString("base64")
  );
const closed = now + 86400001;
const proposal = (extra = {}) => ({
  action: "propose",
  eventId,
  eventRevision: 1,
  expectedRevision: 0,
  requestId: crypto.randomUUID(),
  outcome: "yes",
  evidenceUrl: "https://example.org/result",
  rationale: "The cited result meets the original published resolution rule.",
  ...extra,
});
const confirmation = (revision = 1) => ({
  action: "confirm",
  eventId,
  expectedRevision: revision,
  requestId: crypto.randomUUID(),
  acknowledgement: "CONFIRM_FINAL_OUTCOME_NO_PAYOUT",
});
async function held() {
  const s = setup();
  await startPractice(s.db, s.a);
  await startPractice(s.db, s.b);
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  await placePractice(s.db, s.b, order({ outcome: "no", quantity: 2 }), now);
  return s;
}
test("only active configured administrator can propose/list/confirm; evidence and strict inputs required", async () => {
  const s = setup();
  await assert.rejects(
    saveResolution(s.db, s.b, "a", proposal(), closed),
    (e) => e.status === 403,
  );
  await assert.rejects(
    listResolutions(s.db, s.a, undefined),
    (e) => e.status === 403,
  );
  for (const changed of [
    { evidenceUrl: "javascript:alert(1)" },
    { evidenceUrl: "https://user:pass@example.org" },
    { rationale: "short" },
    { creditUnits: 100 },
    { outcome: "maybe" },
  ])
    await assert.rejects(
      saveResolution(s.db, s.a, "a", proposal(changed), closed),
      (e) => e.status === 400,
    );
  await assert.rejects(
    saveResolution(
      s.db,
      s.a,
      "a",
      { ...confirmation(), acknowledgement: "pay" },
      closed,
    ),
    (e) => e.status === 400,
  );
});
test("deadline and event revision are enforced; proposed result stays unpublished", async () => {
  const s = setup();
  await assert.rejects(
    saveResolution(s.db, s.a, "a", proposal(), now),
    (e) => e.status === 409,
  );
  await assert.rejects(
    saveResolution(s.db, s.a, "a", proposal({ eventRevision: 2 }), closed),
    (e) => e.status === 409,
  );
  const p = proposal();
  await saveResolution(s.db, s.a, "a", p, closed);
  assert.equal((await publicResolution(s.db, eventId)).resolution, null);
  const rows = await listResolutions(s.db, s.a, "a", 0, closed);
  assert.equal(rows.events[0].resolutionStatus, "proposed");
  assert.equal(rows.events[0].rationale, p.rationale);
});
test("save and final confirmation retries are idempotent; final result cannot be edited", async () => {
  const s = setup(),
    p = proposal();
  await saveResolution(s.db, s.a, "a", p, closed);
  await saveResolution(s.db, s.a, "a", p, closed);
  const c = confirmation();
  const r = await saveResolution(s.db, s.a, "a", c, closed);
  assert.deepEqual(await saveResolution(s.db, s.a, "a", c, closed), r);
  assert.equal(r.payoutApplied, false);
  assert.equal(r.resolution.status, "final");
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM resolution_actions").get().n,
    2,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM audit_entries").get().n,
    2,
  );
  await assert.rejects(
    saveResolution(
      s.db,
      s.a,
      "a",
      proposal({ expectedRevision: 2, outcome: "no" }),
      closed,
    ),
    (e) => e.status === 409,
  );
  await assert.rejects(
    saveResolution(s.db, s.a, "a", { ...p, outcome: "no" }, closed),
    (e) => e.status === 409,
  );
  assert.equal(
    (await publicResolution(s.db, eventId)).resolution.outcome,
    "yes",
  );
});
test("stale proposal confirmation fails; edits preserve prior evidence in immutable action history", async () => {
  const s = setup();
  await saveResolution(s.db, s.a, "a", proposal(), closed);
  await saveResolution(
    s.db,
    s.a,
    "a",
    proposal({ expectedRevision: 1, outcome: "no" }),
    closed,
  );
  await assert.rejects(
    saveResolution(s.db, s.a, "a", confirmation(1), closed),
    (e) => e.status === 409,
  );
  await saveResolution(s.db, s.a, "a", confirmation(2), closed);
  assert.equal(
    (await publicResolution(s.db, eventId)).resolution.outcome,
    "no",
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM resolution_actions").get().n,
    3,
  );
});
test("concurrent proposals allow one revision and audit failure rolls back state", async () => {
  const s = setup();
  s.sql.exec(
    "CREATE TRIGGER reject_resolution_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  await assert.rejects(
    saveResolution(s.db, s.a, "a", proposal(), closed),
    /audit unavailable/,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM event_resolutions").get().n,
    0,
  );
  assert.equal(
    s.sql.prepare("SELECT COUNT(*) n FROM resolution_actions").get().n,
    0,
  );
  s.sql.exec("DROP TRIGGER reject_resolution_audit");
  const r = await Promise.allSettled([
    saveResolution(s.db, s.a, "a", proposal(), closed),
    saveResolution(s.db, s.a, "a", proposal({ outcome: "no" }), closed),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
});
test("event change after proposal blocks final confirmation", async () => {
  const s = setup();
  await saveResolution(s.db, s.a, "a", proposal(), closed);
  s.sql.exec("UPDATE own_events SET revision=2");
  await assert.rejects(
    saveResolution(s.db, s.a, "a", confirmation(), closed),
    (e) => e.status === 409,
  );
  assert.equal((await publicResolution(s.db, eventId)).resolution, null);
});
test("YES and NO settlement estimates are private, exact and do not credit or redeem", async () => {
  for (const outcome of ["yes", "no"]) {
    const s = await held(),
      cash = s.sql
        .prepare("SELECT * FROM practice_cash ORDER BY user_id")
        .all();
    const pending = await settlementPreview(s.db, s.a, eventId);
    assert.equal(pending.positions[0].estimatedCreditUnits, null);
    await saveResolution(s.db, s.a, "a", proposal({ outcome }), closed);
    await saveResolution(s.db, s.a, "a", confirmation(), closed);
    const a = await settlementPreview(s.db, s.a, eventId),
      b = await settlementPreview(s.db, s.b, eventId);
    assert.equal(
      a.positions[0].estimatedCreditUnits,
      outcome === "yes" ? 80000 : 0,
    );
    assert.equal(
      b.positions[0].estimatedCreditUnits,
      outcome === "no" ? 80000 : 0,
    );
    assert.equal(a.payoutApplied, false);
    assert.deepEqual(
      s.sql.prepare("SELECT * FROM practice_cash ORDER BY user_id").all(),
      cash,
    );
    assert.equal(
      (await practiceAccount(s.db, s.a, 0, closed)).positions[0].quantity,
      2,
    );
    await assert.rejects(
      settlementPreview(s.db, { userId: "c" }, eventId),
      (e) => e.status === 404,
    );
  }
});
test("VOID model returns principal plus exact paid fee; hidden events stay private", async () => {
  const s = await held();
  await saveResolution(s.db, s.a, "a", proposal({ outcome: "void" }), closed);
  await saveResolution(s.db, s.a, "a", confirmation(), closed);
  const p = (await settlementPreview(s.db, s.a, eventId)).positions[0];
  assert.equal(p.estimatedCreditUnits, 48120);
  s.sql.exec("UPDATE own_events SET status='archived'");
  await assert.rejects(
    publicResolution(s.db, eventId),
    (e) => e.status === 404,
  );
  assert.equal(
    (await settlementPreview(s.db, s.a, eventId)).positions[0]
      .estimatedCreditUnits,
    48120,
  );
  s.sql.exec("UPDATE app_users SET status='suspended' WHERE id='a'");
  await assert.rejects(
    settlementPreview(s.db, s.a, eventId),
    (e) => e.status === 403,
  );
});
