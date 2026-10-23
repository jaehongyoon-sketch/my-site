# Event — Prediction Market & Matching Engine

[![CI](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml)

A virtual-funds prediction market for user-created binary events, with complementary YES/NO order matching, exact monetary accounting, and trade-derived position valuation.

The project combines a working trading application with reproducible experiments on execution mechanics, matching performance, and inventory-adjusted contract buying.

**[Live Application](https://every-event.jaehong-yoon.workers.dev) · [Trading Demo](https://www.youtube.com/watch?v=yHVU8Il0_k4) · [CI History](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml)**

Built with **TypeScript, React, Vinext, Cloudflare Workers, and Cloudflare D1**.

## Project Highlights

| Area | Implementation and evidence |
|---|---|
| Trading workflow | Order submission, partial execution, cancellation, and released reservations |
| Matching engine | Complementary pricing, acceptance-order processing, maker-price execution, and self-match prevention |
| Accounting | Integer monetary units, exact fees, reserved funds, and fee-inclusive position valuation |
| Execution mechanics | 40 controlled conditions covering depth, fragmentation, and quote–limit compatibility |
| Performance | 270 recorded measurements across nine book-size/workload combinations |
| Strategy comparison | 168 simulated episodes, including 48 held-out paths shared by two policies |
| Verification | Automated trading tests, TypeScript checks, and production-build CI |

## Trading Demonstration

The [two-account demonstration](https://www.youtube.com/watch?v=yHVU8Il0_k4) follows an order through its lifecycle:

1. Submit a limit order.
2. Execute a partial fill against an opposing order.
3. Cancel the remaining unfilled quantity.
4. Review the retained position, updated order state, and released reservation.

## Matching Engine

Each matched YES/NO pair contributes one virtual dollar of principal before fees:

```text
YES execution price + NO execution price = 100¢
```

Opposing buy orders become eligible to match when:

```text
YES limit price + NO limit price ≥ 100¢
```

Incoming orders are considered in acceptance order. For each incoming order, eligible earlier opposing orders are ranked by limit price, then acceptance order. The earlier order executes at its limit price, and the later order pays the complementary price.

Eligibility checks include account status, trading restrictions, event status and revision, order expiry, and remaining quantity. Orders from the same account cannot match each other.

### Execution Example

| Step | Action | Result |
|---|---|---|
| 1 | A submits YES at 60¢ for 10 contracts | Funds are reserved and the order rests |
| 2 | B submits NO with a 50¢ limit for 3 contracts | Three pairs execute at YES 60¢ / NO 40¢ |
| 3 | A cancels the remaining 7 contracts | Unfilled reservations are released |
| 4 | Accounts are reviewed | Executed positions remain |

B receives 10¢ of price improvement relative to its limit. Before fees, the three matched pairs commit $1.80 from A and $1.20 from B.

**Implementation:** [Matching logic](lib/practice/matching.ts) · [Order processing](lib/practice/service.ts)

## Accounting and Market Data

Monetary calculations use integer units:

```text
1 cent = 400 internal units
$1     = 40,000 internal units
```

For a current-policy order priced at `p` cents with quantity `q`, the 0.25% trading fee is represented exactly:

```text
Principal = p × q × 400 units
Fee       = p × q units
Reserve   = Principal + Fee
```

Accounts receive a one-time $1,000 virtual allocation. Guarded updates and atomic database batches connect executions to order progress, reserved funds, available funds, and execution costs.

Cancellation releases reservations for unfilled quantity. It preserves executed holdings.

Market prices originate from completed executions. Resting orders contribute depth, while markets without executions remain unpriced. Matched volume counts each YES/NO pair once.

```text
Executable YES price = 100¢ − eligible resting NO bid
Executable NO price  = 100¢ − eligible resting YES bid
```

The portfolio uses trade-derived marks:

```text
Marked position value = quantity × latest outcome execution price
Unrealized P&L        = marked value − fee-inclusive acquisition cost
```

**Implementation:** [Money arithmetic](lib/practice/money.ts) · [Market data](lib/practice/market.ts) · [Position valuation](lib/practice/positions.ts)

## Controlled Market Microstructure Study

**Research question:** How do opposing depth, order fragmentation, and price constraints affect execution through the implemented matching service?

Each condition starts with a fresh in-memory SQLite database and three distinct funded accounts. Both YES and NO incoming orders are tested.

| Experiment | Variable | Conditions |
|---|---|---:|
| Executable depth | 0, 3, 10, or 30 opposing contracts | 8 |
| Order fragmentation | Ten contracts split into orders of size 10, 5, 2, or 1 | 8 |
| Quote–limit compatibility | Maker bids of 40/50/60¢ × incoming limits of 35/40/50/60¢ | 24 |

All **40 deterministic conditions passed** in the linked GitHub Actions run.

### Findings

For a ten-contract incoming order at compatible prices, opposing depths of 0, 3, 10, and 30 produce final fill rates of 0%, 30%, 100%, and 100%.

At identical prices and total depth, fragmentation changes the quantity filled on the initial call:

| Maker orders | Contracts per order | First-call fill rate | Final fill rate | Additional calls |
|---:|---:|---:|---:|---:|
| 1 | 10 | 100% | 100% | 0 |
| 2 | 5 | 100% | 100% | 0 |
| 5 | 2 | 80% | 100% | 1 |
| 10 | 1 | 40% | 100% | 2 |

The engine processes up to four maker–taker matches per call. Fragmented liquidity can therefore require continuation calls even when aggregate depth is unchanged.

The price grid also confirms that displayed quantity becomes executable only within the incoming limit. Against a resting YES bid of 60¢, a NO limit of 35¢ remains unfilled, while a 50¢ limit executes at 40¢.

### Measurements

```text
YES ask           = 100¢ − best NO bid
YES spread        = YES ask − best YES bid
Executable depth  = opposing quantity within the incoming limit
Fill rate         = executed quantity / requested quantity
Price improvement = incoming limit − execution price
```

Every condition checks quantity bounds, maker ordering, complementary principal, fees, reservation movements, cash conservation, and position reconciliation.

Each condition runs once. These are controlled mechanism experiments; the quote grid varies both spread and execution price.

**Evidence:** [Successful run](https://github.com/jaehongyoon-sketch/my-site/actions/runs/39821619889) · [Experiment source](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/experiments/microstructure/run.mjs) · [Metric definitions](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/experiments/microstructure/metrics.mjs) · [Metric tests](https://github.com/jaehongyoon-sketch/my-site/blob/d1412efab273cbb49c4ac50119e444b3e30f6466/tests/microstructure-metrics.test.mjs)

## Matching Performance Baseline

The benchmark measures service-call completion time with 10, 100, and 1,000 resting orders across three workloads.

Each combination uses five warm-up iterations and 30 measured repetitions: **270 recorded measurements across nine conditions**.

### Results

Median completion time in milliseconds:

| Resting orders | No match | One maker fill | Eight maker fills |
|---:|---:|---:|---:|
| 10 | 0.940 | 1.598 | 6.986 |
| 100 | 1.842 | 4.269 | 21.360 |
| 1,000 | 81.937 | 243.642 | 1,297.211 |

**Environment:** GitHub Actions Linux x64, Node.js 22.14.0, SQLite 3.47.2, AMD EPYC 7763 runner with four logical CPUs.

Measurements use an in-memory SQLite test adapter, warm caches, and sequential service calls. Logical state, including acceptance-order row IDs, is restored before each iteration.

Completion includes required continuation calls and their account reads. Database preparation, state restoration, and postcondition assertions are outside the timed section. HTTP and remote D1 latency are excluded.

The eight-fill workload holds eligible maker count and executed quantity constant across book sizes. Increasing completion time provides a baseline for investigating candidate selection and database-query performance.

**Evidence:** [Successful run](https://github.com/jaehongyoon-sketch/my-site/actions/runs/39661515710) · [Raw timing samples](https://github.com/jaehongyoon-sketch/my-site/blob/9ab7a4e9c552828aeee8edee62833db6941ff66c/matching-benchmark-522f2cf88b7cb7d7c97744fec218460e24f8db38/baseline.json) · [Benchmark source](https://github.com/jaehongyoon-sketch/my-site/blob/522f2cf88b7cb7d7c97744fec218460e24f8db38/benchmarks/matching.mjs)

## Inventory-Adjusted Contract Buying

**Research question:** Can inventory-adjusted buy quotes reduce YES/NO position imbalance, and what execution and valuation trade-offs accompany that reduction?

The experiment compares two policies through the existing order-placement and cancellation services:

| Policy | Quoting rule |
|---|---|
| Fixed | Buy YES at 45¢ and NO at 45¢ |
| Inventory-adjusted | Lower the bid for the overweight outcome and raise the bid for the underweight outcome |

Both policies receive $1,000, quote up to three contracts per outcome, and use an absolute net-inventory cap of 30 contracts.

For net inventory `I = YES holdings − NO holdings`:

```text
Skew    = sign(I) × round(abs(I) × k), capped at ±15¢
YES bid = 45¢ − skew
NO bid  = 45¢ + skew
```

Orders are refreshed between arrivals. Unfilled reservations are released, while executed holdings accumulate without resale or collateral recycling.

### Development and Evaluation

The experiment uses three synthetic order-flow regimes:

- **Balanced:** equal YES/NO arrival probabilities and a constant 50% reference probability.
- **Directional:** 80% of arrivals favor one outcome while reference probability remains 50%.
- **Informed shift:** reference probability changes from 50% to 35% or 65% halfway through the episode, followed by arrivals biased toward the more likely outcome.

Each episode contains 60 arrivals. Paired policies receive identical incoming orders and terminal event outcomes.

Parameter selection uses **18 development paths** and candidate skews of 0.25, 0.5, and 1 cent per net contract:

```text
Selection score = mean terminal reference-value P&L
                  − 0.02 × mean time-average absolute inventory
```

The inventory penalty is an explicit experiment preference. The selected parameter, **k = 1**, is then evaluated on **48 separate paths**, with 16 per regime.

The full run contains **168 episodes**: 72 development episodes and 96 evaluation episodes.

### Common Valuation

Both strategies use the same terminal outcome and reference probability.

```text
Reference P&L = YES quantity × p + NO quantity × (1 − p)
                − executed principal − fees

Terminal P&L  = winning contract quantity × $1
                − executed principal − fees
```

Neither the next arrival nor the reference probability or terminal outcome is supplied to the quoting policy. Valuation is performed offline; it does not execute an application settlement transaction.

For each episode, fill rate is the number of contracts executed against the quoting policy divided by the total quantity submitted by external incoming orders. The table reports the mean of these episode-level fill rates. Mean absolute net inventory is averaged over arrivals within each episode and then across the 16 evaluation paths.

### Evaluation Results

The following values are means over the 16 held-out paths in each regime. P&L is in virtual USD after execution fees.

| Regime | Policy | Terminal P&L | Reference P&L | Mean absolute net inventory | Fill rate |
|---|---|---:|---:|---:|---:|
| Balanced | Fixed | 5.307 | 2.838 | 7.739 | 32.6% |
| Balanced | Inventory-adjusted | 2.562 | 2.000 | 2.643 | 30.8% |
| Directional | Fixed | 0.630 | 2.349 | 14.953 | 26.4% |
| Directional | Inventory-adjusted | 1.497 | 1.528 | 4.387 | 21.1% |
| Informed shift | Fixed | −4.659 | −1.659 | 13.175 | 32.6% |
| Informed shift | Inventory-adjusted | −1.565 | 1.200 | 8.946 | 33.8% |

Inventory adjustment reduced time-average absolute net holdings by **65.9%, 70.7%, and 32.1%**, respectively.

This reduction involved a trade-off. Execution rates and reference-value P&L decreased in balanced and directional flow. Under the informed-shift scenario, inventory adjustment improved reference-value P&L and reduced terminal losses.

Selected paired differences, calculated as inventory-adjusted minus fixed:

| Regime | Metric | Mean difference | 95% bootstrap interval |
|---|---|---:|---|
| Balanced | Reference P&L | −$0.838 | [−$0.968, −$0.700] |
| Directional | Reference P&L | −$0.821 | [−$0.986, −$0.631] |
| Informed shift | Reference P&L | +$2.859 | [+$2.619, +$3.117] |
| Directional | Terminal P&L | +$0.867 | [−$4.347, +$5.819] |

Intervals use 2,000 bootstrap resamples of whole paired episodes within each regime. They are conditional on the synthetic generator and selected parameter. The directional terminal-P&L interval includes zero.

### Validation and Provenance

The local run passed **29 related tests** and execution/accounting assertions across all **168 episodes**. Node.js 22.14.0 and 24.19.0 produced identical episode metrics, parameter selection, and summary results.

Local validation environment: **macOS arm64, Node.js 22.14.0, SQLite 3.47.2**.

The experiment also completed successfully on GitHub Actions at commit [`f7b9ba6`](https://github.com/jaehongyoon-sketch/my-site/commit/f7b9ba61c69b707dc9eecced3a8b0bfd5128449d). The workflow passed policy and trading regression tests, completed the development and held-out comparison, and uploaded the generated evidence.

**Evidence:** [Successful experiment run](https://github.com/jaehongyoon-sketch/my-site/actions/runs/40003911312) · [Experiment runner](https://github.com/jaehongyoon-sketch/my-site/blob/f7b9ba61c69b707dc9eecced3a8b0bfd5128449d/experiments/inventory-strategy/run.mjs) · [Policy and valuation definitions](https://github.com/jaehongyoon-sketch/my-site/blob/f7b9ba61c69b707dc9eecced3a8b0bfd5128449d/experiments/inventory-strategy/model.mjs) · [Experiment documentation](https://github.com/jaehongyoon-sketch/my-site/blob/f7b9ba61c69b707dc9eecced3a8b0bfd5128449d/docs/inventory-strategy.md)

Base application commit: [`ceea85b`](https://github.com/jaehongyoon-sketch/my-site/commit/ceea85b24557cf6cf8b4f3e8b98d32622214e2f5). This identifies the application version used before adding the experiment files; experiment-source hashes are recorded separately in `results.json`.

The runner produces:

- `results.json`: configuration, environment, source hashes, summaries, and episode metrics.
- `paths.json`: shared arrival paths and terminal outcomes.
- `selection.json`: development-stage parameter selection.
- `episodes.csv`: individual episode results and fee sensitivity.
- `trajectories.csv`: per-arrival quotes, inventory, and reference P&L.
- `report.md` and `inventory.svg`: tables, interpretation, and predefined example paths.

The study evaluates finite-horizon inventory control under declared synthetic conditions. Its central result is the relationship between inventory concentration, execution rate, and fee-inclusive value.

### Reproduce the Strategy Experiment

Use a separate checkout of the experiment commit with Node.js 22.14.0:

```bash
git clone https://github.com/jaehongyoon-sketch/my-site.git event-inventory-experiment
cd event-inventory-experiment
git checkout f7b9ba61c69b707dc9eecced3a8b0bfd5128449d
npm ci

node --experimental-strip-types --test \
  tests/inventory-strategy.test.mjs \
  tests/day11.test.mjs \
  tests/day12.test.mjs \
  tests/market-prices.test.mjs

node experiments/inventory-strategy/run.mjs
```

Generated results are written to `experiments/inventory-strategy/results/`.

## Automated Verification

GitHub Actions installs locked dependencies, runs automated tests, checks TypeScript, and builds the Cloudflare production configuration.

The test harness applies SQL migrations to fresh in-memory SQLite databases and creates isolated accounts and events.

| Area | Behavior checked |
|---|---|
| Matching | Complementary prices, partial fills, and execution ordering |
| Cancellation | Remaining quantities and released reservations |
| Market data | Execution-derived prices and counted-once volume |
| Valuation | Fee-inclusive costs and position reconciliation |
| Eligibility | Self-matching, expiry, pauses, and restrictions |
| Failure handling | Accounting consistency after failed operations |

### Reproduce Application Checks

With Node.js 22.14.0 installed:

```bash
npm ci
npm test
npm run typecheck
EVENT_CLOUDFLARE_BUILD=1 npm run build
```

The final command uses macOS/Linux shell syntax. CI builds the application without deploying it.

**Evidence:** [CI history](https://github.com/jaehongyoon-sketch/my-site/actions/workflows/ci.yml) · [Workflow](.github/workflows/ci.yml) · [Test suite](tests/) · [Test harness](tests/helpers/practice.mjs)

## Architecture

```text
React interface
      │
      ▼
API validation and authentication
      │
      ▼
Cloudflare Workers
      ├── Event management
      ├── Order validation and reservations
      ├── Complementary matching
      └── Market data and position valuation
                    │
                    ▼
              Cloudflare D1
```

| Component | Responsibility |
|---|---|
| TypeScript / React / Vinext | Event pages, order entry, market display, and portfolio |
| Cloudflare Workers | Request handling and trading services |
| Cloudflare D1 | Accounts, events, orders, executions, and accounting state |
| Google OAuth | Authentication |
| SQL migrations | Database schema management |

## Administrator Access and Market Operations

Administrator access is tied to an active application account through the server-side `ADMIN_ACCOUNT_ID` setting. Privileged pages and API endpoints verify the authenticated account.

| Area | Functionality |
|---|---|
| Event management | Create and edit drafts, publish events, archive events, and delete eligible drafts |
| Account oversight | Inspect profiles, account status, roles, and unexpired session counts |
| Trading eligibility | Manage account trading restrictions |
| Market operations | Pause or resume practice trading |
| Outcome review | Review event outcomes |
| Audit history | Inspect recorded administrative actions |

Published event questions and rules are locked to preserve the terms under which orders were placed. Revision checks detect conflicting changes, and administrative mutations record audit entries.

**Implementation:** [Authorization](lib/accounts/access.ts) · [Event administration](lib/events/service.ts) · [Administrative API](app/api/admin/events/route.ts) · [Operations interface](app/admin/operations/panel.tsx)

## Trading Interface and Domain Types

The interface connects event discovery, saved events, order entry, trade history, and portfolio monitoring. Market data updates every five seconds while the page is visible.

Navigation adapts to authentication and administrative permissions, with desktop and mobile access to the primary workflows.

TypeScript domain definitions represent outcomes, order requests, estimates, and lifecycle states. Runtime schemas validate submitted data, including:

- Allowed outcomes and event statuses.
- Integer quantities and price ranges.
- Event titles, rules, source URLs, and closing dates.
- Revision numbers used to detect stale updates.

Trading services apply eligibility, matching, and accounting rules after request validation.

**Implementation:** [Domain types](lib/domain/types.ts) · [Lifecycle definitions](lib/domain/lifecycle.ts) · [Validation schemas](lib/domain/validation.ts) · [Navigation](components/app-navigation.tsx)

## Code Guide

| File | Purpose |
|---|---|
| [`lib/practice/matching.ts`](lib/practice/matching.ts) | Candidate selection, execution prices, and matching updates |
| [`lib/practice/service.ts`](lib/practice/service.ts) | Order submission, cancellation, continuation, and account state |
| [`lib/practice/money.ts`](lib/practice/money.ts) | Integer principal, fee, and reservation calculations |
| [`lib/practice/market.ts`](lib/practice/market.ts) | Trade prices, market depth, and volume |
| [`lib/practice/positions.ts`](lib/practice/positions.ts) | Holdings, acquisition costs, and valuation |
| [`app/events/market-panel.tsx`](app/events/market-panel.tsx) | Market visualization and quote interaction |
| [`tests/market-prices.test.mjs`](tests/market-prices.test.mjs) | Pricing and valuation verification |
| [`drizzle/`](drizzle/) | Database migrations |
