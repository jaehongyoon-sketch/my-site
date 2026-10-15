# Day 10 — practice order acceptance

Implemented separate D1 practice wallets, orders and append-only ledger entries. No real-money tables, exchange APIs, payments or actual trading are enabled.

## User flow
1. Sign in and create an active Event profile.
2. Open `/practice`, acknowledge virtual funds, and receive a one-time $1,000 practice grant.
3. Open a published event, enter a limit buy and review amounts.
4. Choose **Place practice order** to reserve principal plus the 0.25% estimated fee. Fee is half-up rounded once per order to cents. No fee is collected and no fill is produced.
5. Check available/reserved balances and paginated own orders at `/practice`.

## Guarantees
- Identity derives from the Google session; caller cannot specify a user, total, fee or execution environment.
- Order idempotency is durable, scoped by account and client request UUID. Same intent replays the stored result; changed intent conflicts.
- Conditional order insertion, wallet reservation and ledger entry execute in one D1 atomic batch. Active user, published event, current revision, unexpired deadline and sufficient funds are checked inside that transaction.
- Concurrent distinct requests cannot over-reserve; concurrent duplicates reserve once. Any ledger failure rolls back all changes.
- Practice grant never repeats after reload, retries or account reactivation.
- Expired orders and orders invalidated by hiding/revising an event release their full reservation once. This runs on practice reads/submissions, not a background timer. No event outcome is inferred.
- UI freezes the review while submission is uncertain and retains its request ID for exact retries. Leaving/reloading loses this tab-local retry state; the UI warns before leaving and instructs checking order history before a new request. Server idempotency records persist.
- Real `/api/orders` remains disabled. Matching, fills, cancellation and payouts are future work.

## Verification
Service tests cover one-time grants, duplicate and conflicting retries, concurrent spending, transactional rollback, expiration/hidden-event release, ledger reconciliation, account isolation, forged input, stale revisions and suspended users. Synthetic HTTP tests use only local accounts/events.
