import { activeAccount, AccessError } from "../accounts/access";
import type { Identity } from "../accounts/service";
import { fundingIntentSchema, FundingUnavailable } from "./model";
export async function fundingStatus(db: D1Database, identity: Identity) {
  await activeAccount(db, identity);
  return {
    connection: "not_connected" as const,
    depositsEnabled: false,
    withdrawalsEnabled: false,
    currency: "USD" as const,
    practiceFundsWithdrawable: false,
    transfers: [],
    message:
      "A payment provider is not connected. Your practice grant is virtual and cannot be withdrawn.",
  };
}
export async function requestFunding(
  db: D1Database,
  identity: Identity,
  raw: unknown,
): Promise<never> {
  await activeAccount(db, identity);
  if (!fundingIntentSchema.safeParse(raw).success)
    throw new AccessError(400, "Invalid funding request.");
  // Intentionally no database mutation or provider request on this path.
  throw new FundingUnavailable();
}
