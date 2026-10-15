import { z } from "zod";
export const orderIntentSchema = z
  .object({
    eventId: z.string().uuid(),
    eventRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    side: z.literal("buy"),
    orderType: z.literal("limit"),
    timeInForce: z.literal("until-close"),
    outcome: z.enum(["yes", "no"]),
    limitPriceCents: z.number().int().min(1).max(99),
    quantity: z.number().int().min(1).max(10000),
  })
  .strict();
export type OrderIntent = z.infer<typeof orderIntentSchema>;
export const orderPreviewSchema = z
  .object({
    previewId: z.string().uuid(),
    intent: orderIntentSchema,
    eventTitle: z.string(),
    checkedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    orderDeadline: z.string().datetime(),
    calculation: z
      .object({
        priceCents: z.number().int(),
        quantity: z.number().int(),
        principalCents: z.number().int(),
        feeCents: z.number().finite(),
        feeRateBps: z.literal(25),
        totalCents: z.number().finite(),
        netProfitCents: z.number().finite(),
        payoutCents: z.number().int(),
        grossProfitCents: z.number().int(),
      })
      .strict(),
    executable: z.literal(false),
    priceBasis: z.literal("user_limit"),
    mode: z.literal("review_only"),
    checks: z
      .object({
        account: z.literal("active"),
        event: z.literal("published_before_close"),
        balance: z.literal("not_connected"),
        execution: z.literal("not_connected"),
      })
      .strict(),
  })
  .strict();
export type OrderPreview = z.infer<typeof orderPreviewSchema>;
