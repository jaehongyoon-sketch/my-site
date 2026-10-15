import { z } from "zod";
// Decimal USD is converted to integer cents at the boundary by a future UI.
// Account identity, provider references, and state never come from this input.
export const fundingIntentSchema = z
  .object({
    requestId: z.string().uuid(),
    direction: z.enum(["deposit", "withdrawal"]),
    currency: z.literal("USD"),
    amountCents: z.number().int().min(1).max(10000000),
  })
  .strict();
export type FundingIntent = z.infer<typeof fundingIntentSchema>;
export type TransferStatus =
  "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "reversed";
export const transferStatusLabels: Record<TransferStatus, string> = {
  pending: "Awaiting processing",
  processing: "Processing",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  reversed: "Reversed",
};
const next: Record<TransferStatus, readonly TransferStatus[]> = {
  pending: ["processing", "failed", "cancelled"],
  processing: ["succeeded", "failed", "cancelled"],
  succeeded: ["reversed"],
  failed: [],
  cancelled: [],
  reversed: [],
};
// Pure transition validation only. A provider notification is not a ledger entry.
// Integration must verify the webhook and atomically deduplicate + post accounting.
export function transitionTransfer(
  current: TransferStatus,
  target: TransferStatus,
): TransferStatus {
  if (current === target) return current;
  if (!next[current]?.includes(target))
    throw Error("Invalid transfer transition");
  return target;
}
export type ProviderTransfer = {
  providerId: string;
  providerTransferId: string;
  requestId: string;
  direction: FundingIntent["direction"];
  currency: "USD";
  amountCents: number;
  status: TransferStatus;
};
export interface FundingProvider {
  readonly id: string;
  createTransfer(
    command: FundingIntent & { verifiedAccountReference: string },
  ): Promise<ProviderTransfer>;
  getTransfer(providerTransferId: string): Promise<ProviderTransfer>;
}
export class FundingUnavailable extends Error {
  readonly status = 503;
  readonly code = "FUNDING_NOT_CONNECTED";
  constructor() {
    super(
      "Deposits and withdrawals are not connected. No transfer was created and no money moved.",
    );
  }
}
// No environment toggle or client flag can activate payments. Replace this only
// with an approved server integration, separate real ledger, and verified accounts.
export const disconnectedProvider: FundingProvider = {
  id: "not-connected",
  async createTransfer() {
    throw new FundingUnavailable();
  },
  async getTransfer() {
    throw new FundingUnavailable();
  },
};
