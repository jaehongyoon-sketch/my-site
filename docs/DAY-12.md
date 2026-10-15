# Day 12 — practice cancellation and fill/cancel races

Users can cancel the unfilled remainder of their own practice orders from `/practice`. Confirmation shows the last observed remaining quantity and reservation and explains that fills can arrive first. The server uses current values, never client-provided amounts. Full or partial earlier fills and their fees stay recorded; there is no cancellation fee.

`POST /api/practice/cancel` accepts only `{orderId}` and requires an active Google-linked Event profile, same-origin JSON, and ownership. Foreign and missing orders both return 404. Administrators cannot cancel another user's orders through this endpoint.

The owned order ID is the natural idempotency key. A new `practice_cancellations` receipt stores the quantity, exact refunded units and time. A single D1 batch inserts the receipt conditionally, makes the order terminal, returns the held funds, writes the release journal and increments progress revision. Concurrent retries return the same receipt and cannot refund twice. Storage failure rolls back the whole cancellation.

For compatibility, persisted order status is `voided` with the dedicated cancellation receipt; the API and UI expose `cancelled`. Existing expired/hidden orders remain distinguishable. Existing rows and earlier migration files are unchanged. The new migration creates an empty table only; it cancels no orders on deployment.

A fill that commits first reduces the remaining quantity and refund. If cancellation commits first, the matcher’s in-transaction state/revision checks reject its stale candidate. A fully filled order returns `already_filled`, and an expired/closed order returns `already_closed`; neither creates a cancellation receipt. Retrying the original placement never reopens a cancelled order.

The UI reports the authoritative result, refreshes balances/history, shows cancellation time and returned funds, and allows safe cancellation retries after a timeout. The confirmation itself does not cancel anything. Real trading stays disabled. The $1 YES/NO pair price and per-contract 0.25% fee policy from Day 11 are unchanged.

Tests cover whole and partial cancellation, concurrent duplicate requests, both deterministic fill/cancel race orderings, failed journal rollback/retry, ownership and inactive accounts, stale placement retries, and already-terminal orders. Local HTTP checks use synthetic accounts and events only.
