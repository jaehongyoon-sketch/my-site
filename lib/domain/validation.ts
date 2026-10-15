import { z } from "zod";
export const quoteRequestSchema = z
  .object({
    marketId: z.string().min(1).max(120),
    outcome: z.enum(["yes", "no"]),
    quantity: z.number().int().min(1).max(10000),
  })
  .strict();
export const quoteSchema = quoteRequestSchema.extend({
  id: z.string(),
  providerId: z.string(),
  priceCents: z.number().int().min(1).max(99),
  principalCents: z.number().int().nonnegative(),
  payoutCents: z.number().int().nonnegative(),
  grossProfitCents: z.number().int().nonnegative(),
  feeCents: z.number().int().nonnegative(),
  feeRateBps: z.literal(25),
  totalCents: z.number().int().nonnegative(),
  netProfitCents: z.number().int(),
  exchangeFeeCents: z.null(),
  executable: z.literal(false),
  expiresAt: z.string().datetime(),
});
