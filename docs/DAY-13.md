# Day 13 — practice holdings and acquisition cost

`/practice` now presents a practice portfolio: cash, holdings, orders and fills. Holdings are grouped by event and outcome. YES and NO are never netted. Each position shows filled quantity, quantity-weighted average execution price, average cost including fees, principal, actual paid fees, total acquisition cost and last fill time. Averages are rounded only for display; monetary totals remain exact integer 1/400-cent units.

The projection reads all committed `practice_match_entries` joined to `practice_matches` and owned orders. It does not use order quantities, client storage, progress counters or the latest-50-fill UI. Open/cancelled/expired unfilled quantities contribute nothing. Already-filled quantities remain after cancellation, event closing or hiding. Historical fee policies are reflected through actual recorded fees.

Holdings paginate 20 positions at a time independently of orders. Global totals always include all events and fills. The authenticated account ID is server-derived; no other user's holdings or counterpart identity is returned. Cash, orders, recent fills, positions and global totals are read in one D1 batch for a consistent snapshot. Total acquisition cost is compared with cumulative cash spent; an actual discrepancy is shown explicitly.

There is no price feed, realized/unrealized profit, market valuation, selling, payout or settlement in this version. Settlement remains pending. No new balance mutations or database migration are introduced. The existing $1 YES/NO pair and per-contract 0.25% fee rules remain unchanged.

Tests cover weighted prices, both outcomes, partial cancellation, no-fill accounts, more than 50 fills, hidden/closed events, ownership isolation, independent pagination/global totals, invalid pages and discrepancy reporting. Local HTTP tests verify authenticated responses and exact units using disposable test accounts only.
