import { z } from "zod";
import type { OwnEvent } from "./service";
export const PRICE_MAX_AGE_MS = 30_000;
export const PRICE_FUTURE_TOLERANCE_MS = 5_000;
// Internal adapter contract only: never accept these fields from a customer request.
export const priceSnapshotSchema = z
  .object({
    eventId: z.string().uuid(),
    eventRevision: z.number().int().positive(),
    source: z.literal("event-orderbook"),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    observedAt: z.string().datetime(),
    yesAskCents: z.number().int().min(1).max(99).nullable(),
    noAskCents: z.number().int().min(1).max(99).nullable(),
  })
  .strict();
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export const marketStateSchema = z.object({
  eventId: z.string().uuid(),
  eventRevision: z.number().int().positive(),
  phase: z.enum(["upcoming", "closed", "hidden", "invalid"]),
  closesAt: z.string(),
  checkedAt: z.string().datetime(),
  pricing: z.enum(["unavailable", "fresh", "stale", "invalid"]),
  priceSource: z.literal("event-orderbook").nullable(),
  priceAsOf: z.string().datetime().nullable(),
  priceValidUntil: z.string().datetime().nullable(),
  yesAskCents: z.number().int().min(1).max(99).nullable(),
  noAskCents: z.number().int().min(1).max(99).nullable(),
  canTrade: z.literal(false),
  blockCode: z.enum([
    "EVENT_HIDDEN",
    "EVENT_CLOSED",
    "EVENT_INVALID",
    "PRICE_UNAVAILABLE",
    "PRICE_STALE",
    "PRICE_INVALID",
    "EXECUTION_UNAVAILABLE",
  ]),
  result: z.literal("not_determined"),
  feeRateBps: z.literal(25),
});
export type MarketState = z.infer<typeof marketStateSchema>;
export function deriveMarketState(
  event: Pick<OwnEvent, "id" | "revision" | "status" | "closesAt">,
  raw: unknown = null,
  now = Date.now(),
): MarketState {
  const closing = Date.parse(event.closesAt);
  const phase =
    event.status !== "published"
      ? "hidden"
      : !Number.isFinite(closing)
        ? "invalid"
        : closing <= now
          ? "closed"
          : "upcoming";
  const base: MarketState = {
    eventId: event.id,
    eventRevision: event.revision,
    phase,
    closesAt: event.closesAt,
    checkedAt: new Date(now).toISOString(),
    pricing: "unavailable",
    priceSource: null,
    priceAsOf: null,
    priceValidUntil: null,
    yesAskCents: null,
    noAskCents: null,
    canTrade: false,
    blockCode:
      phase === "hidden"
        ? "EVENT_HIDDEN"
        : phase === "invalid"
          ? "EVENT_INVALID"
          : phase === "closed"
            ? "EVENT_CLOSED"
            : "PRICE_UNAVAILABLE",
    result: "not_determined",
    feeRateBps: 25,
  };
  if (phase !== "upcoming" || raw === null) return base;
  const parsed = priceSnapshotSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.eventId !== event.id ||
    parsed.data.eventRevision !== event.revision ||
    Date.parse(parsed.data.observedAt) > now + PRICE_FUTURE_TOLERANCE_MS
  )
    return { ...base, pricing: "invalid", blockCode: "PRICE_INVALID" };
  const price = parsed.data;
  const observed = Date.parse(price.observedAt);
  const stamp = {
    priceSource: price.source,
    priceAsOf: price.observedAt,
    priceValidUntil: new Date(observed + PRICE_MAX_AGE_MS).toISOString(),
  };
  if (now - observed >= PRICE_MAX_AGE_MS)
    return { ...base, ...stamp, pricing: "stale", blockCode: "PRICE_STALE" };
  if (price.yesAskCents === null && price.noAskCents === null)
    return { ...base, ...stamp, blockCode: "PRICE_UNAVAILABLE" };
  // Even a valid future feed cannot turn on execution. Order acceptance is a separate capability.
  return {
    ...base,
    ...stamp,
    pricing: "fresh",
    yesAskCents: price.yesAskCents,
    noAskCents: price.noAskCents,
    blockCode: "EXECUTION_UNAVAILABLE",
  };
}
// Monotonic full snapshots only. Newer full snapshots may bridge missed updates; conflicting duplicates are rejected.
export function reconcilePriceSnapshot(
  previous: PriceSnapshot | null,
  incoming: unknown,
): PriceSnapshot {
  const next = priceSnapshotSchema.parse(incoming);
  if (!previous) return next;
  if (
    next.eventId !== previous.eventId ||
    next.eventRevision !== previous.eventRevision
  )
    throw new Error("Price snapshot scope mismatch");
  if (next.sequence < previous.sequence) return previous;
  if (next.sequence === previous.sequence) {
    if (
      next.observedAt !== previous.observedAt ||
      next.yesAskCents !== previous.yesAskCents ||
      next.noAskCents !== previous.noAskCents ||
      next.source !== previous.source
    )
      throw new Error("Conflicting price snapshot");
    return previous;
  }
  if (Date.parse(next.observedAt) < Date.parse(previous.observedAt))
    throw new Error("Price timestamp moved backwards");
  return next;
}
