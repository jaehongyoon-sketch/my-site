# Day 8 — Event market state and price feed contract

The event detail page now includes a market status panel, independent YES/NO price slots, price source and observation time, status-check time, an unavailable-order button, and the existing 0.25% fee policy. An absent price is a dash, never zero or a fabricated 50/50 probability.

## Runtime behavior
- `GET /api/events/:id/market-state` resolves only published own_events rows. Drafts, archived records and unknown IDs return 404; database failures return 503. Responses are no-store.
- Server time determines the boundary: closes_at <= now is closed. Closed is not resolved; result remains not_determined. A client clock tick updates closure between checks using elapsed monotonic time since a server observation.
- There is **no active price adapter**. The API passes a null snapshot to the shared state function and returns null prices/source. No Kalshi API or fabricated quote is used.
- The panel rechecks immediately, then every 15 seconds while visible, with an 8-second timeout and at most one in-flight request. Returning to the tab or reconnecting triggers a fresh read. Errors hide prices and offer manual refresh; interval retries continue. Offline events hide values immediately.
- Old client values expire locally at priceValidUntil. The page is a status poller, not a WebSocket price stream.
- `/api/quotes` strictly accepts marketId/outcome/quantity and rejects client-supplied prices. Unknown/hidden event: 404; closed event: 409; unconnected pricing: 503. It never creates a quote or an order. `/api/orders` remains unconditionally blocked with 503.

## Internal adapter contract for later work
A complete price snapshot contains eventId, eventRevision, source=event-orderbook, monotonic sequence, observedAt (UTC), and nullable independent integer-cent asks for YES and NO (1–99). The server owns this input. It is not an administrator pricing form or customer request field. One side may have no liquidity; do not derive it as 100 minus the other side.

Snapshots must match the event ID and current revision. Data becomes stale exactly 30,000 ms after observation. Timestamps over 5,000 ms in the future are invalid. Invalid, stale, hidden and closed data cannot produce displayed executable prices. Even a fresh valid snapshot leaves canTrade=false until the separate order acceptance capability is implemented.

The reconciliation helper accepts only full snapshots: older sequences are ignored, exact duplicates are idempotent, conflicting same-sequence data and backwards timestamps are rejected. A newer full snapshot may bridge missed sequence numbers. Reconnection must obtain a full snapshot, never merge guessed missing deltas. This helper is tested groundwork; no production feed currently invokes it.

## Verification
88 automated tests pass, including seven new tests for missing data, independent prices, exact expiry, closure, scope/source validation, empty books and snapshot ordering. Local HTTP checks verify the new state API, hidden-record privacy, quote rejection, cache policy and rendered panel using synthetic local records only. No schema changes or production data mutations are required for Day 8.

Day 9: own-event order request model and server validation. Real-money execution and settlement remain unavailable.
