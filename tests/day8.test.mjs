import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMarketState,
  reconcilePriceSnapshot,
  PRICE_MAX_AGE_MS,
  marketStateSchema,
} from "../lib/events/market-state.ts";
const now = Date.parse("2026-09-27T00:00:00.000Z");
const event = {
  id: "a5c24e0d-a1cc-4cbd-a47f-7ff5d064a10e",
  revision: 3,
  status: "published",
  closesAt: "2026-09-28T00:00:00.000Z",
};
const price = (changes = {}) => ({
  eventId: event.id,
  eventRevision: 3,
  source: "event-orderbook",
  sequence: 1,
  observedAt: new Date(now).toISOString(),
  yesAskCents: 62,
  noAskCents: 41,
  ...changes,
});
test("missing feed gives null prices, unknown result and unavailable orders; no 50/50 fallback", () => {
  const s = deriveMarketState(event, null, now);
  assert.equal(s.pricing, "unavailable");
  assert.equal(s.yesAskCents, null);
  assert.equal(s.noAskCents, null);
  assert.equal(s.priceSource, null);
  assert.equal(s.result, "not_determined");
  assert.equal(s.feeRateBps, 25);
  assert.equal(s.canTrade, false);
  assert.equal(marketStateSchema.safeParse(s).success, true);
});
test("fresh prices preserve independent outcomes and cannot enable execution", () => {
  const s = deriveMarketState(event, price(), now);
  assert.equal(s.pricing, "fresh");
  assert.equal(s.yesAskCents, 62);
  assert.equal(s.noAskCents, 41);
  assert.equal(s.blockCode, "EXECUTION_UNAVAILABLE");
  assert.equal(s.canTrade, false);
  assert.equal(
    deriveMarketState(event, price({ noAskCents: null }), now).noAskCents,
    null,
  );
});
test("prices expire exactly at 30 seconds and are hidden", () => {
  assert.equal(
    deriveMarketState(event, price(), now + PRICE_MAX_AGE_MS - 1).pricing,
    "fresh",
  );
  const s = deriveMarketState(event, price(), now + PRICE_MAX_AGE_MS);
  assert.equal(s.pricing, "stale");
  assert.equal(s.blockCode, "PRICE_STALE");
  assert.equal(s.yesAskCents, null);
  assert.equal(s.noAskCents, null);
});
test("closing time wins over fresh prices, and closure never implies settlement", () => {
  const s = deriveMarketState(
    { ...event, closesAt: new Date(now).toISOString() },
    price(),
    now,
  );
  assert.equal(s.phase, "closed");
  assert.equal(s.blockCode, "EVENT_CLOSED");
  assert.equal(s.yesAskCents, null);
  assert.equal(s.result, "not_determined");
  for (const status of ["draft", "archived"]) {
    const hidden = deriveMarketState({ ...event, status }, price(), now);
    assert.equal(hidden.phase, "hidden");
    assert.equal(hidden.priceSource, null);
  }
});
test("mismatched event/revision, invalid prices/source and future timestamps fail closed", () => {
  for (const change of [
    { eventId: "941ab714-4702-4880-a778-53147c1f165a" },
    { eventRevision: 2 },
    { yesAskCents: 0 },
    { noAskCents: 100 },
    { yesAskCents: 5.5 },
    { source: "admin" },
    { observedAt: new Date(now + 5001).toISOString() },
  ]) {
    const s = deriveMarketState(event, price(change), now);
    assert.equal(s.pricing, "invalid");
    assert.equal(s.yesAskCents, null);
    assert.equal(s.canTrade, false);
  }
  assert.equal(
    deriveMarketState({ ...event, closesAt: "invalid" }, price(), now).phase,
    "invalid",
  );
});
test("empty book retains no prices and does not invent liquidity", () => {
  const s = deriveMarketState(
    event,
    price({ yesAskCents: null, noAskCents: null }),
    now,
  );
  assert.equal(s.blockCode, "PRICE_UNAVAILABLE");
  assert.equal(s.yesAskCents, null);
  assert.equal(s.noAskCents, null);
});
test("full snapshots reject cross-event/conflicting duplicates and ignore old updates", () => {
  const p = price({ sequence: 10 });
  assert.equal(reconcilePriceSnapshot(p, price({ sequence: 9 })), p);
  assert.equal(reconcilePriceSnapshot(p, { ...p }), p);
  assert.throws(
    () => reconcilePriceSnapshot(p, { ...p, yesAskCents: 63 }),
    /Conflicting/,
  );
  assert.throws(
    () => reconcilePriceSnapshot(p, { ...p, eventRevision: 4 }),
    /scope/,
  );
  assert.throws(
    () =>
      reconcilePriceSnapshot(p, {
        ...p,
        sequence: 11,
        observedAt: new Date(now - 1).toISOString(),
      }),
    /backwards/,
  );
  assert.equal(reconcilePriceSnapshot(p, { ...p, sequence: 15 }).sequence, 15);
});
