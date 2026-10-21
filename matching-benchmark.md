# Matching benchmark

This experiment measures the existing prediction-market service against the same in-memory SQLite adapter used by the automated tests. It makes no requests to production, requires no credentials, and does not change matching rules.

## Research question

How does resting-book size affect sequential order-processing latency? How much additional work is required to complete eight fills when a matching call processes at most four pairs?

## Reproduce

Use Node.js 22.14.0 (the GitHub workflow version), then run from the repository root:

```sh
npm ci
node benchmarks/matching.mjs --smoke
node benchmarks/matching.mjs
```

The smoke run uses 10/100 orders, one warmup and three recorded samples per condition. The baseline uses 10/100/1,000 orders, five warmups and 30 recorded samples per condition: nine conditions, 270 recorded samples, 45 additional warmups. Smoke measurements are for debugging, not the baseline report.

The dedicated `Matching benchmark` GitHub workflow runs on relevant pushes to `matching-benchmark`. Once the workflow exists on the default branch, it can also be launched manually through Actions. It installs locked dependencies, measures the service, publishes a summary, and uploads JSON and a log as artifacts. It does not deploy the website or access D1. Timing thresholds are deliberately not CI pass/fail gates.

## Workload

All resting orders belong to account A, are YES orders, and have quantity one. Account B submits NO at 40 cents. Both accounts receive the existing $1,000 virtual grant. No balances are increased artificially.

| Scenario | Eligible makers at YES 60 cents | Other makers at YES 10 cents | Incoming NO quantity | Expected fills |
|---|---:|---:|---:|---:|
| no-match | 0 | N | 1 | 0 |
| single-fill | 1 | N−1 | 1 | 1 |
| eight-fills | 8 | N−8 | 8 | 8 |

N is 10, 100 or 1,000. Eligible makers are inserted first; equal-price execution follows their acceptance rowids. Holding the eight-fill quantity constant lets us vary book size without also changing executed volume. This is not a sweep of all 1,000 orders.

Fixtures are created through `startPractice` and `placePractice`. Before measuring, the script verifies the order count and absence of fills. Each repetition restores the same logical database state, including rowids, and checks foreign keys. SQLite caches remain warm; this is not a cold-start benchmark. IDs vary, but prices, account identities, quantities and acceptance ordering are deterministic.

## Timing boundaries

- `initialMs`: time spent in the initial `placePractice` service call.
- `completionMs`: initial call plus any `continueMatching` service calls needed to finish the target quantity. Continuation includes its existing account/position reads.
- Setup, snapshot restoration, order-input construction, compilation and post-run assertions are excluded.
- Calls are sequential, with two accounts and one event. No HTTP, network, browser, concurrency or Cloudflare D1 execution is measured.

Every JSON result includes raw samples, median, nearest-rank p95, min/max, Node/SQLite version, CPU/OS, source commit and benchmark-file SHA-256. With 30 repetitions, p95 is an exploratory tail statistic, not a service-level guarantee. Compare repeated runs on the same environment; do not compare a laptop and a shared GitHub runner as an optimization result.

## Correctness gates

Every warmup and recorded sample asserts:

- Exact match count and executed quantity, expected maker rowid order, one contract per fill, and distinct counterparties.
- Exactly two ledger entries per match; combined principal is 40,000 integer units ($1), and combined fee is 100 units under the current fee policy.
- Reservation debit equals principal plus fee plus released funds.
- Order fills stay within quantity; remaining reservations match unfilled quantities at their limit prices.
- Account reserved funds match held order funds; account spending matches executed principal plus fees.
- Available + reserved + spent remains 40,000,000 units ($1,000) per account.

An assertion failure stops the run. No success result is written for an incomplete baseline. The artifact log remains available for diagnosis.

## Reading results

A growing median suggests more work at larger book sizes under this workload. It does not establish algorithmic complexity from three measurements. If eight fills require an extra continuation call, report that alongside timing rather than treating the first four fills as full completion.

Use the workflow's own results for the published baseline. Preserve its run URL, commit and artifact before the 30-day retention expires. Keep the raw JSON with a named environment/date if committing a result, and link it from the README. Do not claim production throughput, concurrent capacity or improved performance without separate evidence.
