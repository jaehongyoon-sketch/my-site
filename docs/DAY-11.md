# Day 11 — practice matching, partial fills, per-contract fees

## Terms
New practice buys match a different account's opposite outcome when their limits cross. Executed YES + NO prices always total **100 cents per pair**, before fees. An older resting order is the maker and receives its limit; the later order pays the complement, never more than its limit. Opposing resting orders use best price then acceptance rowid; the oldest eligible incoming order is processed first. No self-trades, fabricated liquidity, real-money trades, payouts or sell orders.

New fee policy: **0.25% of each filled contract's execution price**, with no cent rounding. At YES 60¢ and NO 40¢, per-contract fees are $0.0015 and $0.001. One accounting unit is 1/400 cent ($0.000025); every balance mutation uses integers. UI cents may be fractional and display up to six dollar decimals. Actual pair principal is $1, fees are additional.

## State and accounting
Each accepted order has progress: filled quantity, remaining quantity, executed principal, fee paid, reservation held, and revision. Partially filled orders stay open. Completion is derived from filled=quantity; original immutable request and order identity persist. Price improvement releases unused principal and fee reservation. Expiration or hiding an event releases only the unfilled reservation. Filled contracts remain recorded and are not automatically refunded or resolved.

`practice_cash` is the authoritative balance: available + reserved + spent = initial 40,000,000 units. `practice_cash_entries` records grants/reservations/releases. Each match has exactly two `practice_match_entries` with principal, fee, released funds and reservation debit. Combining these journals reproduces balances. Earlier `practice_wallets`, `practice_ledger`, and integer quote columns are retained as compatibility history and are not authoritative for new money calculations.

## Migration safety
0006 adds exact-unit tables and copies the Day 10 balances and journals without changing economic values. Existing orders remain open under `legacy_order` fee policy: their original 0.25% per-order rounding is honored and clearly labeled. No order is canceled, no grant repeats, no balance is reset. New orders use `per_contract`. 0007 only adds the event-book query index.

## Atomic matching and retries
A fill reselects the highest-priority eligible pair inside the D1 transaction and verifies both progress revisions. It rechecks event visibility/revision/deadline and both account statuses. The pair record, both progress updates, cash movements and entries commit together or roll back together. Competing matchers cannot overfill. Admission is a separate durable transaction; a failed match can leave a valid open order, which the same client request can retry without re-reservation.

Each request tries at most four matches to bound work. New submissions and idempotent retries trigger matching; `/api/practice/match` continues it for an authenticated owner of an event order. `Match available orders` exposes continuation. No background matching worker exists yet. Merely refreshing order history never triggers new fills.

## UI
`/practice` shows available/reserved/spent virtual funds, partial/full status, quantities, exact filled cost and fee, and latest 50 own fills. Others' identities and order details remain private. The site is still owner-private; actual multi-account UI testing requires an explicitly approved audience change. Service and local HTTP tests use synthetic accounts only.

## Tests
Coverage: $1 pair collateral, best price/time priority, same-user prevention, partial remainder, price improvement, all 99 fee prices, repeated/concurrent requests, rollback, event change during matching, expiration after partial fills, bounded continuation, exact sub-cent fees and preservation of prior orders. Real order endpoint remains disabled. Position accounting, sell support, cancellation and event settlement remain future days.
