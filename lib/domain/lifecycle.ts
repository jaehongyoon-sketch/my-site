/** Canonical states. Provider adapters must normalize and validate their own states. */
export const executionStatuses = [
  "submitting",
  "unknown",
  "accepted",
  "partially_filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];
export type OrderStatus = ExecutionStatus | "cancel_pending";
export const transferStatuses = [
  "requested",
  "unknown",
  "pending",
  "completed",
  "failed",
  "canceled",
  "returned",
] as const;
export type TransferStatus = (typeof transferStatuses)[number];
export const accountStatuses = [
  "unlinked",
  "pending",
  "active",
  "restricted",
  "closed",
] as const;
export const verificationStatuses = [
  "not_started",
  "pending",
  "verified",
  "rejected",
] as const;
export type Environment = "development" | "sandbox" | "live";
export type LinkedAccount = {
  id: string;
  userId: string;
  connectionId: string;
  environment: Environment;
  status: (typeof accountStatuses)[number];
  verification: (typeof verificationStatuses)[number];
};
// Monetary values use safe integer cents in this milestone. Not suitable for
// sub-cent venues without a separately reviewed scale conversion.
export type BalanceSnapshot = {
  accountId: string;
  currency: "USD";
  cashCents: number;
  buyingPowerCents: number;
  withdrawableCents: number;
  reservedCents: number;
  providerRevision: number;
  observedAt: string;
};
export type PositionSnapshot = {
  accountId: string;
  marketId: string;
  outcome: "yes" | "no";
  quantity: number;
  reservedQuantity: number;
  providerRevision: number;
};
export type FillRecord = {
  id: string;
  accountId: string;
  orderId: string;
  externalFillId: string;
  quantity: number;
  priceCents: number;
  feeCents: number;
  executedAt: string;
};
