# Controlled order-book microstructure experiments

## Questions and predictions specified before execution

1. With eligible accounts, an open event and fixed prices, does executable opposing depth determine final fill quantity? Prediction: `min(requested quantity, compatible opposing depth)`.
2. At identical price and total depth, does order fragmentation affect first-call fills under the current four-match-per-call cap? Prediction: more than four required maker matches can leave quantity for continuation.
3. Across a grid of maker bids and incoming limits, when is displayed liquidity executable? Prediction: the opposing limits must sum to at least 100 cents.

These predictions follow from the implemented mechanism. This is a reproducible mechanism study, not a forecasting model or a claim about real trader behavior.

## Design

Each condition starts a fresh in-memory SQLite database through the existing test helper and applies the repository migrations. Three distinct active accounts receive the existing $1,000 virtual grant. A posts opposing liquidity, B posts ten contracts at 30 cents on the incoming side, and C submits ten contracts. All fixtures and executions use the existing service functions. No production database or credentials are used.

| Family | Conditions per direction | Variable | Held constant |
|---|---:|---|---|
| Depth | 4 | Opposing quantity: 0, 3, 10, 30 | Maker 60 cents, incoming limit 40 cents; single maker order when depth > 0 |
| Fragmentation | 4 | Maker order size: 10, 5, 2, 1 | Total opposing quantity 10, maker 60 cents, incoming limit 40 cents |
| Quote/limit grid | 12 | Maker bid 40/50/60 cents × incoming limit 35/40/50/60 cents | Opposing quantity 10 in a single order |

Both incoming YES and incoming NO are exercised: 40 conditions total. Each deterministic condition is run once; rerunning it is a reproducibility check, not an additional independent market observation. The service's current four-match limit is asserted explicitly. If the mechanism changes, revisit the hypothesis and expected results rather than silently relaxing checks.

Changing maker price in the quote grid changes both the spread and incoming execution quote. The experiment does not identify an independent causal effect of spread. A later design would need to vary spread while holding executable depth and the incoming limit relative to its quote appropriately controlled.

## Measurements

- `yesSpreadCents`: `(100 - best NO bid) - best YES bid`.
- `executableDepth`: opposing quantity available at or below the incoming buyer's limit, before submission.
- `initialFillRate`: filled quantity after the first service call divided by requested quantity.
- `finalFillRate`: filled quantity after required continuations divided by requested quantity.
- `continuations`: number of additional service calls used to complete the price-compatible quantity.
- `executionPriceCents`: quantity-weighted price of the incoming order's executions, excluding fees; null for no fill.
- `priceImprovementCents`: incoming limit minus execution price; null for no fill.
- `feeUnits`: incoming order's total execution fees in exact internal units (400 units per cent).

Missing quotes/spreads are null in JSON and blank in CSV. Negative spreads are retained. The four-match limit can leave a temporarily crossed book after an initial call. Incoming and maker accounts are distinct; displayed depth is actionable for C in these controlled fixtures. These aggregate metrics must not be reused as personalized production quotes without accounting for self-matching and account eligibility.

Snapshots are taken before submission, after the initial call and after continuation. The dataset is not filtered after seeing results. All 40 conditions, including non-fills, remain in the output.

## Validation

The runner checks expected initial and final fills, maker acceptance order, match volume, complementary principal, exact fees, reservation debits, nonnegative bounded quantities, held funds, per-account $1,000 cash conservation and position reconciliation. Independent metric tests cover missing versus zero spread, exact limit boundaries, both outcomes and negative spreads. Failures stop the run and remove stale success outputs at startup.

## Reproduce

With Node.js 22.14.0 (the workflow version):

```sh
npm ci
node --experimental-strip-types --test tests/microstructure-metrics.test.mjs tests/day11.test.mjs tests/day12.test.mjs tests/market-prices.test.mjs
node experiments/microstructure/run.mjs
```

Outputs:

- `experiments/microstructure/results/results.json`: full observations, environment, source commit, script and engine hashes.
- `experiments/microstructure/results/observations.csv`: one row per condition.
- `experiments/microstructure/results/report.md`: tables and interpretation.

The `Market microstructure` workflow runs on relevant pushes to `market-microstructure`. Manual dispatch becomes available when the workflow exists on the default branch. The workflow publishes its report in the run summary and retains downloadable artifacts for 30 days. Preserve a successful run's artifact and URL when publishing results.

The observations support conclusions about this engine's deterministic rules. They do not establish real-market statistical relationships, out-of-sample prediction quality or net strategy profitability. Those require distinct follow-up experiments and data.
