# Event — Prediction Market & Matching Engine

[![CI](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml)

A virtual-funds prediction market for user-created binary events, featuring complementary YES/NO order matching, trade-derived prices, and position valuation.

**[Live Application](https://every-event.jaehong-yoon.workers.dev)**

Built with **TypeScript, React, Cloudflare Workers, and Cloudflare D1**.

Trading Demo

A walkthrough of the virtual-funds trading workflow using two accounts:

Submit a limit order.

Execute a partial fill against an opposing order.

Cancel the remaining unfilled quantity.

Review the updated order status, retained position, and released reservation.

The demonstration shows how order execution and cancellation affect the market interface and account state.

https://www.youtube.com/watch?v=yHVU8Il0_k4

## Overview

Event connects the lifecycle of a prediction-market order: submission, fund reservation, matching, execution, and portfolio valuation.

Participants express a view through YES or NO limit orders. Compatible orders from different accounts form matched contracts, and completed trades establish the market’s observed price.

The system maintains a clear distinction between:

- **Limit price:** the maximum price a participant is willing to pay.
- **Executable quote:** the price available against an eligible opposing order.
- **Last-traded price:** the price of the most recent completed trade.
- **Position value:** holdings valued using the latest observed execution price.

## Controlled Market Microstructure Study

Controlled experiments examine how opposing liquidity, order fragmentation, and price constraints affect execution through the existing trading services.

Each condition starts with a fresh in-memory SQLite database and three distinct funded accounts. Both YES and NO incoming orders are tested across **40 deterministic conditions**.

| Experiment | Variable | Conditions |
|---|---|---:|
| Executable depth | 0, 3, 10, or 30 opposing contracts | 8 |
| Order fragmentation | Ten contracts split into orders of size 10, 5, 2, or 1 | 8 |
| Quote–limit compatibility | Maker bids of 40/50/60¢ × incoming limits of 35/40/50/60¢ | 24 |

### Findings

**Executable depth determines the available final fill under compatible prices.** For a ten-contract incoming order, opposing depths of 0, 3, 10, and 30 produce final fill rates of 0%, 30%, 100%, and 100%, respectively.

**Order fragmentation affects immediate execution even when total depth and price remain unchanged.**

| Maker orders | Contracts per order | First-call fill rate | Final fill rate | Additional matching calls |
|---:|---:|---:|---:|---:|
| 1 | 10 | 100% | 100% | 0 |
| 2 | 5 | 100% | 100% | 0 |
| 5 | 2 | 80% | 100% | 1 |
| 10 | 1 | 40% | 100% | 2 |

The engine processes up to four maker–taker matches per call. Fragmented liquidity can therefore require continuation calls to complete the same quantity.

**Book depth becomes executable only within the incoming limit.** A resting YES bid of 60¢ offers a complementary NO execution price of 40¢. A NO limit of 35¢ remains unfilled, while a 50¢ limit executes at 40¢, receiving 10¢ of price improvement before fees.

### Measurements and Validation

```text
YES ask           = 100¢ − best NO bid
YES spread        = YES ask − best YES bid
Executable depth  = opposing quantity priced within the incoming limit
Fill rate         = executed quantity / requested quantity
Price improvement = incoming limit − execution price
```

The runner records initial and final fills, spreads, execution prices, fees, and continuation counts. Every condition checks quantity bounds, maker ordering, complementary principal, exact fees, reservation movements, cash conservation, and position reconciliation.

All **40 conditions passed** in the linked GitHub Actions run. Each deterministic condition runs once. The quote grid varies both spread and execution price; its results describe quote–limit compatibility.

Outputs include:

- `results.json`: observations, source commit, runtime environment, and source-file hashes.
- `observations.csv`: one row per condition.
- `report.md`: result tables and interpretation.
- `run.log`: execution and validation records.

**Evidence:** [Successful experiment run](https://github.com/jaehongyoon-sketch/my-site/actions/runs/39821619889) · [Experiment source](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/experiments/microstructure/run.mjs) · [Metric definitions](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/experiments/microstructure/metrics.mjs) · [Metric tests](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/tests/microstructure-metrics.test.mjs)

## Matching Performance Baseline

The benchmark measures service-call completion time with **10, 100, and 1,000 resting orders** across three scenarios: no match, one maker fill, and eight maker fills.

Each combination uses five warm-up iterations and 30 measured iterations, producing **270 recorded timing samples**. Logical database state, including acceptance-order row IDs, is restored before each iteration.

### Results

Median completion time in milliseconds:

| Resting orders | No match | One maker fill | Eight maker fills |
|---:|---:|---:|---:|
| 10 | 0.940 | 1.598 | 6.986 |
| 100 | 1.842 | 4.269 | 21.360 |
| 1,000 | 81.937 | 243.642 | 1,297.211 |

**Environment:** GitHub Actions Linux x64 runner, Node.js 22.14.0, SQLite 3.47.2, and an AMD EPYC 7763 CPU reported by the runner.

Measurements use the in-memory SQLite test adapter, warm caches, and sequential execution. Completion time includes required continuation calls and their account reads. Fixture creation, state restoration, and postcondition assertions are outside the timed section.

The eight-fill scenario holds the number of eligible makers constant across book sizes. The results establish a reproducible baseline for evaluating changes to candidate selection and matching-service work. Timings cover the local service path, excluding HTTP and remote D1 latency.

**Evidence:** [Successful benchmark run](https://github.com/jaehongyoon-sketch/my-site/actions/runs/39661515710) · [Raw timing samples and environment](https://github.com/jaehongyoon-sketch/my-site/blob/9ab7a4e9c552828aeee8edee62833db6941ff66c/matching-benchmark-522f2cf88b7cb7d7c97744fec218460e24f8db38/baseline.json) · [Benchmark source](https://github.com/jaehongyoon-sketch/my-site/blob/522f2cf88b7cb7d7c97744fec218460e24f8db38/benchmarks/matching.mjs)

## Matching Engine

Binary contracts use a complementary pricing relationship:

```text
YES execution price + NO execution price = 100¢
```

Opposing buy orders become eligible to match when:

```text
YES limit price + NO limit price ≥ 100¢
```

The matching process checks account eligibility, event status, order expiry, and available quantity. Orders belonging to the same account cannot match each other.

Incoming orders are considered in acceptance order. For each incoming order, eligible earlier opposing orders are ranked by limit price, then acceptance order. The earlier order executes at its limit price, and the later order pays the complementary price.

### Execution Example

| Step | Order | Result |
|---|---|---|
| 1 | Account A submits YES at 60¢ for 10 contracts | Order rests in the book |
| 2 | Account B submits NO with a 50¢ limit for 3 contracts | Combined limits satisfy the matching condition |
| 3 | Three contract pairs execute | A pays 60¢ per YES; B pays 40¢ per NO |
| 4 | The book updates | A retains 7 unfilled contracts |

Before fees, the matched quantities commit:

```text
Account A: 3 × $0.60 = $1.80
Account B: 3 × $0.40 = $1.20
Total:                  $3.00
```

Each matched YES/NO pair therefore contributes $1. Partial fills preserve the remaining order quantity.

**Implementation:** [Matching logic](lib/practice/matching.ts) · [Order processing](lib/practice/service.ts)

## Market Data & Price Formation

Market prices are derived from completed trades. Unfilled orders contribute to available depth without being recorded as executions.

The market interface provides:

- Latest YES execution price and change from the preceding trade.
- A chart of recent execution prices.
- Available quantities at executable YES and NO prices.
- Recent trade history and matched volume.
- Market updates every five seconds while the page is visible.

A YES purchase quote is derived from the complementary resting NO order, and vice versa:

```text
Executable YES price = 100¢ − resting NO bid
Executable NO price  = 100¢ − resting YES bid
```

Matched volume counts each contract pair once. Markets without executions remain explicitly unpriced.

**Implementation:** [Market data](lib/practice/market.ts) · [Market interface](app/events/market-panel.tsx)

## Accounting & Position Valuation

Monetary calculations use integer units throughout the trading logic:

```text
1 cent = 400 internal units
$1     = 40,000 internal units
```

This representation supports exact calculation of the 0.25% trading fee for cent-denominated contract prices, avoiding floating-point rounding in order costs and reservations.

For price `p` in cents and quantity `q`:

```text
Principal = p × q × 400 internal units
Fee       = p × q internal units
Reserve   = Principal + Fee
```

Accounts receive a one-time allocation of $1,000 in virtual funds. Order processing tracks reserved funds, executed costs, and remaining quantities.

Positions use the latest execution price for the corresponding outcome:

```text
Marked position value = Quantity × Latest outcome price
Unrealized P&L        = Marked position value − Fee-inclusive acquisition cost
```

The portfolio separates trade-derived valuation from positions that do not yet have an observed market price.

**Implementation:** [Monetary arithmetic](lib/practice/money.ts) · [Position valuation](lib/practice/positions.ts)

## Transaction Integrity

Order processing combines validation, guarded database updates, and atomic batches to keep order state and account balances consistent.

The implementation addresses:

- Partial fills and remaining executable quantities.
- Prevention of self-matching.
- Expired orders and changes to event eligibility.
- Paused markets and restricted accounts.
- Revision checks during state changes.
- Consistent accounting when a database operation fails.

These checks connect the market’s economic rules to its persisted state: a displayed trade must correspond to a recorded execution and its associated accounting entries.

## Verification

The GitHub Actions run for commit [`125df10`](https://github.com/jaehongyoon-sketch/my-site/commit/125df10) completed **210 tests: 210 passed, 0 failed**.

Market-specific tests cover:

| Area | Verified behavior |
|---|---|
| Price formation | Prices originate from recorded executions |
| Complementary contracts | YES and NO execution prices sum to 100¢ |
| Empty markets | No artificial last-traded price |
| Order depth | Remaining quantities reflect partial fills |
| Trade history | Executions appear in chronological order |
| Volume | Each matched pair is counted once |
| Position valuation | Acquisition costs include fees |
| Eligibility | Self-matching, expiry, pauses, and restrictions are checked |
| Failure handling | Failed operations preserve accounting consistency |

Validation commands:

```bash
# Project test suite
node --experimental-strip-types --test tests/*.test.mjs

# Type checking
npx tsc --noEmit

# Application build
npm run build

# Cloudflare production build
EVENT_CLOUDFLARE_BUILD=1 npm run build
```

**Tests:** [Market pricing and valuation](tests/market-prices.test.mjs) · [Full test directory](tests/)

### Continuous Integration

GitHub Actions validates the project on pushes to `main` and `repo-cleanup`, and on pull requests targeting `main`.

The workflow runs in a fresh Ubuntu environment with Node.js 22.14.0 and performs four checks:

| Step | Verification |
|---|---|
| Dependency installation | Installs dependencies from `package-lock.json` using `npm ci` |
| Automated tests | Runs the test suite, including matching, cancellation, accounting, and market valuation checks |
| Type checking | Checks TypeScript types and module resolution |
| Production build | Builds the application using the Cloudflare production configuration |

The test suite includes an in-memory SQLite harness that applies the project’s SQL migrations and creates isolated test accounts and events.

A successful CI run was recorded for commit [`125df10`](https://github.com/jaehongyoon-sketch/my-site/commit/125df10). Subsequent results are available in the [CI execution history](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml).

### Reproduce the Checks

With Node.js 22.14.0 installed, run the following commands from the repository root:

```bash
npm ci
npm test
npm run typecheck
```

Build with the production configuration on macOS or Linux:

```bash
EVENT_CLOUDFLARE_BUILD=1 npm run build
```

The CI workflow validates the production build without deploying it.

**Configuration:** [GitHub Actions workflow](.github/workflows/ci.yml) · [Test harness](tests/helpers/practice.mjs)

## Architecture

```text
React Interface
      │
      ▼
Cloudflare Workers
      │
      ├── Google OAuth & account access
      ├── User-created event management
      ├── Order validation & fund reservation
      ├── Complementary order matching
      └── Market data & position valuation
                    │
                    ▼
              Cloudflare D1
```

| Component | Responsibility |
|---|---|
| TypeScript / React | Event pages, order entry, market display, and portfolio |
| Cloudflare Workers | Application requests and trading logic |
| Cloudflare D1 | Persistent accounts, events, orders, and executions |
| Google OAuth | Authentication |
| SQL migrations | Database schema management |

## Administrator Access & Market Operations

Administrator access is tied to an active application account through the server-side `ADMIN_ACCOUNT_ID` setting. Administrative pages and API endpoints verify the authenticated account before permitting privileged operations.

The administration interface provides:

| Area | Functionality |
|---|---|
| Event management | Create and edit drafts, publish events, archive published events, and delete eligible drafts |
| Account oversight | View registered profiles, account status, roles, and unexpired session counts |
| Trading eligibility | Manage account trading restrictions |
| Market operations | Pause or resume practice trading |
| Outcome review | Review event outcomes |
| Audit history | Inspect recorded administrative actions |

Published event questions and rules are locked to preserve the terms under which participants placed orders. Event updates use revision checks to detect conflicting changes, while administrative mutations record audit entries.

Authorization is enforced on the server. Navigation adapts to the account’s permissions, providing administrators with event, member, and operational controls.

**Implementation:** [Account authorization](lib/accounts/access.ts) · [Event administration](lib/events/service.ts) · [Administrative API](app/api/admin/events/route.ts) · [Operations interface](app/admin/operations/panel.tsx)

## Trading Interface & Domain Types

The application separates presentation, domain definitions, and persistent trading operations.

```text
UI Components
    │  User input and market display
    ▼
API Validation & Authorization
    │  Validated requests
    ▼
Domain & Trading Services
    │  Matching rules and accounting operations
    ▼
Database
```

### Trading Interface

The interface connects event discovery, order entry, market data, and portfolio monitoring:

- **Explore and Saved:** browse published events and maintain a watchlist.
- **Market view:** inspect execution history, price changes, and available order depth.
- **Order entry:** select an executable price and review quantity and estimated costs.
- **Portfolio:** monitor holdings, acquisition costs, and trade-based valuations.
- **Account-aware navigation:** display sign-in status and authorized administrative controls.

Desktop navigation and mobile bottom navigation provide access to the same primary workflows. Navigation includes active-page indicators, and the application provides a skip link to the main content.

### Domain Types & Runtime Validation

TypeScript definitions represent outcomes, quote requests, order estimates, and lifecycle states. Literal unions make distinctions such as YES versus NO and draft versus published events explicit in the code.

Runtime schemas validate incoming data at application boundaries, including:

- Allowed outcome and event-status values.
- Integer quantities and price ranges.
- Required event titles, rules, source URLs, and closing dates.
- Revision numbers used to detect stale updates.

Static types describe the data expected by application code; runtime validation checks the data actually received. Trading services then enforce account eligibility, matching conditions, and monetary calculations.

**Implementation:** [Domain types](lib/domain/types.ts) · [Lifecycle definitions](lib/domain/lifecycle.ts) · [Validation schemas](lib/domain/validation.ts) · [Event schemas and rules](lib/events/service.ts) · [Application navigation](components/app-navigation.tsx)

## Quantitative Concepts

The implementation makes several market concepts directly observable:

**Order flow and price formation.** Submitted orders create potential liquidity; completed executions establish observed prices.

**Limit constraints and execution quality.** An incoming order can execute below its maximum acceptable price when the opposing resting order permits it.

**Liquidity and partial execution.** Available opposing quantity determines how much of an order can fill immediately.

**Accounting consistency.** Contract prices, fees, reservations, and position costs share a discrete monetary representation.

**Trade-based valuation.** Portfolio marks are calculated from execution records and linked to the cost of acquiring each position.

## Code Guide

| File | Purpose |
|---|---|
| [`lib/practice/matching.ts`](lib/practice/matching.ts) | Matching rules and execution selection |
| [`lib/practice/service.ts`](lib/practice/service.ts) | Order processing and account updates |
| [`lib/practice/money.ts`](lib/practice/money.ts) | Integer monetary calculations |
| [`lib/practice/market.ts`](lib/practice/market.ts) | Trade prices, market depth, and volume |
| [`lib/practice/positions.ts`](lib/practice/positions.ts) | Holdings, cost basis, and valuation |
| [`app/events/market-panel.tsx`](app/events/market-panel.tsx) | Market visualization and quote interaction |
| [`tests/market-prices.test.mjs`](tests/market-prices.test.mjs) | Pricing and valuation verification |
| [`drizzle/`](drizzle/) | Database migrations |
