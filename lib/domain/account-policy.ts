import type {
  LinkedAccount,
  BalanceSnapshot,
  PositionSnapshot,
  Environment,
} from "./lifecycle";
export type AccessDecision =
  { allowed: true } | { allowed: false; reason: string };
/** Pure policy foundation. NOT wired as permission to submit live orders. */
export function checkAccountAccess(input: {
  actorUserId: string;
  actorStatus: "active" | "suspended" | "closed";
  account: LinkedAccount;
  expectedConnectionId: string;
  environment: Environment;
  action: "view" | "trade" | "withdraw";
  providerPermission: boolean;
}): AccessDecision {
  const { account } = input;
  if (account.userId !== input.actorUserId)
    return { allowed: false, reason: "ACCOUNT_NOT_OWNED" };
  if (
    account.connectionId !== input.expectedConnectionId ||
    account.environment !== input.environment
  )
    return { allowed: false, reason: "CONNECTION_MISMATCH" };
  if (input.action === "view") return { allowed: true };
  if (input.actorStatus !== "active")
    return { allowed: false, reason: "APP_ACCOUNT_NOT_ACTIVE" };
  if (account.status !== "active")
    return { allowed: false, reason: "ACCOUNT_NOT_ACTIVE" };
  if (account.verification !== "verified")
    return { allowed: false, reason: "VERIFICATION_REQUIRED" };
  if (!input.providerPermission)
    return { allowed: false, reason: "PROVIDER_PERMISSION_REQUIRED" };
  return { allowed: true };
}
export function validateBalanceSnapshot(
  balance: BalanceSnapshot,
): BalanceSnapshot {
  if (balance.currency !== "USD" || !balance.accountId)
    throw new Error("Invalid balance identity.");
  for (const value of [
    balance.cashCents,
    balance.buyingPowerCents,
    balance.withdrawableCents,
    balance.reservedCents,
    balance.providerRevision,
  ])
    if (!Number.isSafeInteger(value))
      throw new Error("Money and revision must be safe integers.");
  if (
    Math.min(
      balance.buyingPowerCents,
      balance.withdrawableCents,
      balance.reservedCents,
    ) < 0 ||
    balance.providerRevision < 1
  )
    throw new Error("Invalid balance limits.");
  if (!Number.isFinite(Date.parse(balance.observedAt)))
    throw new Error("Invalid observation timestamp.");
  // A provider can report negative cash after a return/correction. Preserve it.
  // Buying power/withdrawable are authoritative fields, not derived from cash.
  return { ...balance };
}
export function availablePosition(position: PositionSnapshot): number {
  if (
    !Number.isSafeInteger(position.quantity) ||
    !Number.isSafeInteger(position.reservedQuantity) ||
    position.quantity < 0 ||
    position.reservedQuantity < 0 ||
    position.reservedQuantity > position.quantity
  )
    throw new Error("Invalid position quantities.");
  return position.quantity - position.reservedQuantity;
}
export function sameIdempotentRequest(
  existing: { requestHash: string },
  incomingHash: string,
): void {
  if (!incomingHash || existing.requestHash !== incomingHash)
    throw new Error("IDEMPOTENCY_CONFLICT");
}
