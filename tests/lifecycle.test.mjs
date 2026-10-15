import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOrderState,
  markSubmissionUnknown,
  requestOrderCancel,
  refuseOrderCancel,
  applyOrderSnapshot,
  orderDisplayStatus,
  ReconciliationRequired,
} from "../lib/domain/order-machine.ts";
import {
  createTransferState,
  markTransferUnknown,
  applyTransferSnapshot,
} from "../lib/domain/transfer-machine.ts";
import {
  checkAccountAccess,
  validateBalanceSnapshot,
  availablePosition,
  sameIdempotentRequest,
} from "../lib/domain/account-policy.ts";
const snapshot = (status, filledQuantity, revision) => ({
  status,
  filledQuantity,
  revision,
});
const accepted = () =>
  applyOrderSnapshot(createOrderState(100), snapshot("accepted", 0, 1));
test("submission timeout remains unknown until authoritative lookup resolves it", () => {
  const unknown = markSubmissionUnknown(createOrderState(100));
  assert.equal(unknown.executionStatus, "unknown");
  assert.throws(() => requestOrderCancel(unknown));
  assert.equal(
    applyOrderSnapshot(unknown, snapshot("filled", 100, 2)).executionStatus,
    "filled",
  );
});
test("cancel request does not release or erase partially filled quantity", () => {
  const partial = applyOrderSnapshot(
    accepted(),
    snapshot("partially_filled", 30, 2),
  );
  const cancel = requestOrderCancel(partial);
  assert.equal(orderDisplayStatus(cancel), "cancel_pending");
  assert.equal(cancel.filledQuantity, 30);
  const raced = applyOrderSnapshot(cancel, snapshot("partially_filled", 70, 3));
  assert.equal(orderDisplayStatus(raced), "cancel_pending");
  assert.equal(raced.filledQuantity, 70);
  const canceled = applyOrderSnapshot(raced, snapshot("canceled", 70, 4));
  assert.equal(orderDisplayStatus(canceled), "canceled");
  assert.equal(canceled.filledQuantity, 70);
});
test("full fill wins a cancel race", () => {
  const filled = applyOrderSnapshot(
    requestOrderCancel(accepted()),
    snapshot("filled", 100, 2),
  );
  assert.equal(filled.cancelRequested, false);
  assert.equal(orderDisplayStatus(filled), "filled");
  assert.throws(() => requestOrderCancel(filled));
});
test("explicit cancel refusal restores execution display, never fabricates fills", () => {
  const state = requestOrderCancel(accepted());
  assert.equal(orderDisplayStatus(refuseOrderCancel(state)), "accepted");
});
test("older snapshots and duplicate snapshots cannot roll back state", () => {
  const state = applyOrderSnapshot(
    accepted(),
    snapshot("partially_filled", 40, 3),
  );
  assert.strictEqual(
    applyOrderSnapshot(state, snapshot("accepted", 0, 1)),
    state,
  );
  assert.strictEqual(
    applyOrderSnapshot(state, snapshot("partially_filled", 40, 3)),
    state,
  );
});
test("same-revision conflicting facts require reconciliation", () => {
  assert.throws(
    () => applyOrderSnapshot(accepted(), snapshot("partially_filled", 40, 1)),
    ReconciliationRequired,
  );
});
test("quantity mismatch and fill busts cannot silently alter order state", () => {
  const state = applyOrderSnapshot(
    accepted(),
    snapshot("partially_filled", 40, 2),
  );
  for (const bad of [
    snapshot("filled", 99, 3),
    snapshot("partially_filled", 0, 3),
    snapshot("partially_filled", 101, 3),
    snapshot("partially_filled", 39, 3),
    snapshot("accepted", 0, 3),
    snapshot("rejected", 40, 3),
  ])
    assert.throws(() => applyOrderSnapshot(state, bad));
  assert.equal(state.filledQuantity, 40);
});
test("terminal orders cannot reopen; late canceled snapshot can retain additional historical fills", () => {
  const canceled = applyOrderSnapshot(accepted(), snapshot("canceled", 30, 2));
  const late = applyOrderSnapshot(canceled, snapshot("canceled", 40, 3));
  assert.equal(late.filledQuantity, 40);
  assert.throws(
    () => applyOrderSnapshot(late, snapshot("partially_filled", 50, 4)),
    ReconciliationRequired,
  );
});
test("newer provider revisions must be safe positive integers", () => {
  for (const revision of [0, NaN, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      applyOrderSnapshot(accepted(), snapshot("accepted", 0, revision)),
    );
});
test("missed intermediate events allow direct full fill and direct rejection", () => {
  assert.equal(
    applyOrderSnapshot(createOrderState(10), snapshot("filled", 10, 10))
      .executionStatus,
    "filled",
  );
  assert.equal(
    applyOrderSnapshot(createOrderState(10), snapshot("rejected", 0, 10))
      .executionStatus,
    "rejected",
  );
});
test("returned funds are distinct from completed and cannot resurrect", () => {
  let state = markTransferUnknown(createTransferState(10000));
  state = applyTransferSnapshot(state, { status: "completed", revision: 2 });
  state = applyTransferSnapshot(state, { status: "returned", revision: 3 });
  assert.equal(state.amountCents, 10000);
  assert.equal(state.status, "returned");
  assert.strictEqual(
    applyTransferSnapshot(state, { status: "completed", revision: 2 }),
    state,
  );
  assert.throws(() =>
    applyTransferSnapshot(state, { status: "completed", revision: 4 }),
  );
});
test("missed payment events can resolve directly to returned", () => {
  assert.equal(
    applyTransferSnapshot(createTransferState(20), {
      status: "returned",
      revision: 3,
    }).status,
    "returned",
  );
});
test("transfer duplicate is harmless but same-revision conflict is rejected", () => {
  const state = applyTransferSnapshot(createTransferState(20), {
    status: "pending",
    revision: 1,
  });
  assert.strictEqual(
    applyTransferSnapshot(state, { status: "pending", revision: 1 }),
    state,
  );
  assert.throws(() =>
    applyTransferSnapshot(state, { status: "completed", revision: 1 }),
  );
  for (const amount of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createTransferState(amount));
});
const account = {
  id: "a1",
  userId: "u1",
  connectionId: "c1",
  environment: "sandbox",
  status: "active",
  verification: "verified",
};
const access = {
  actorUserId: "u1",
  actorStatus: "active",
  account,
  expectedConnectionId: "c1",
  environment: "sandbox",
  action: "trade",
  providerPermission: true,
};
test("account access rejects other users and cross-provider/environment confusion", () => {
  assert.deepEqual(checkAccountAccess(access), { allowed: true });
  assert.equal(
    checkAccountAccess({ ...access, actorUserId: "u2" }).allowed,
    false,
  );
  assert.equal(
    checkAccountAccess({ ...access, expectedConnectionId: "c2" }).allowed,
    false,
  );
  assert.equal(
    checkAccountAccess({ ...access, environment: "live" }).allowed,
    false,
  );
});
test("verification, restriction, and provider permission independently prevent money actions", () => {
  for (const action of ["trade", "withdraw"]) {
    assert.equal(
      checkAccountAccess({ ...access, action, actorStatus: "suspended" })
        .allowed,
      false,
    );
    assert.equal(
      checkAccountAccess({ ...access, action, providerPermission: false })
        .allowed,
      false,
    );
    assert.equal(
      checkAccountAccess({
        ...access,
        action,
        account: { ...account, status: "restricted" },
      }).allowed,
      false,
    );
    assert.equal(
      checkAccountAccess({
        ...access,
        action,
        account: { ...account, verification: "pending" },
      }).allowed,
      false,
    );
  }
  assert.equal(
    checkAccountAccess({
      ...access,
      action: "view",
      account: { ...account, status: "closed" },
    }).allowed,
    true,
  );
});
test("negative provider cash is preserved; buying power is not derived locally", () => {
  const balance = {
    accountId: "a1",
    currency: "USD",
    cashCents: -100,
    buyingPowerCents: 0,
    withdrawableCents: 0,
    reservedCents: 0,
    providerRevision: 1,
    observedAt: "2026-09-26T00:00:00Z",
  };
  assert.deepEqual(validateBalanceSnapshot(balance), balance);
  assert.throws(() =>
    validateBalanceSnapshot({ ...balance, withdrawableCents: -1 }),
  );
  assert.throws(() => validateBalanceSnapshot({ ...balance, cashCents: 0.5 }));
  assert.throws(() =>
    validateBalanceSnapshot({ ...balance, observedAt: "bad" }),
  );
});
test("reserved contracts cannot be resold", () => {
  assert.equal(availablePosition({ quantity: 100, reservedQuantity: 70 }), 30);
  assert.throws(() =>
    availablePosition({ quantity: 10, reservedQuantity: 11 }),
  );
});
test("a reused idempotency key must retain the exact request fingerprint", () => {
  sameIdempotentRequest({ requestHash: "abc" }, "abc");
  assert.throws(
    () => sameIdempotentRequest({ requestHash: "abc" }, "def"),
    /IDEMPOTENCY_CONFLICT/,
  );
});
