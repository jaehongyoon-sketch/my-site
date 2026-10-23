# Two-sided contract buying and inventory adjustment

## Research question

Does adjusting complementary buy quotes using current YES-minus-NO holdings reduce inventory imbalance, and what happens to execution rate and fee-inclusive value?

This experiment uses the application's existing buy-order matching and cancellation services. A liquidity provider buys YES and NO contracts from distinct opposing participants. Holdings accumulate; cancellation removes unfilled orders and releases their reservations, without selling existing holdings. Terminal valuation is calculated offline and does not call or modify application settlement.

## Policies and controls

Let `I = YES holdings - NO holdings`, in contracts.

- Fixed baseline: YES bid 45 cents; NO bid 45 cents.
- Inventory adjustment: `skew = sign(I) × round(abs(I) × k)`, clipped to ±15 cents; YES bid `45 - skew`, NO bid `45 + skew`.
- Candidate `k`: 0.25, 0.5, 1 cent per net contract.
- Both policies receive $1,000, quote up to three contracts per outcome, and use the same absolute inventory cap of 30 contracts. Quantity is reduced near the cap so a complete fill cannot breach it.
- The two buy bids always sum to 90 cents. Under complementary quoting, this corresponds to a ten-cent YES bid/ask spread when both sides are available.
- A higher YES position lowers the YES bid and raises the NO bid. This can reduce additional YES accumulation or attract NO fills; it cannot guarantee an offsetting counterparty.
- All quotes are posted before the next arrival. Remaining incoming and provider orders are cancelled at the end of each step. Provider positions persist, but incoming residual orders do not queue into subsequent steps.
- No quote receives the next arrival, hidden probability, future price path or terminal outcome as an input.

The inventory-risk motivation relates to Avellaneda and Stoikov, [High-frequency trading in a limit order book](https://math.nyu.edu/faculty/avellane/HighFrequencyTrading.pdf). The implemented policy is a simple bounded linear inventory heuristic, rather than an implementation of their optimal-control model.

## Synthetic order flow

Each episode has 60 arrivals. Each arrival submits one YES or NO buy, with quantity uniformly sampled from integers 1–5. Its limit is its outcome's reference probability in cents plus an integer willingness offset uniformly sampled from -8 through +12, bounded to 1–99 cents. The same complete exogenous arrival path is replayed for both strategies.

| Regime | Probability used for evaluation | Arrival direction |
|---|---|---|
| Balanced | 50% throughout | 50% YES / 50% NO |
| Directional | 50% throughout | Randomly select a direction per episode; 80% arrivals on that side |
| Informed shift | 50% for first 30 steps, then 35% or 65% with equal direction probability | Balanced before shift; 80% arrivals toward the more likely outcome after shift |

The provider observes its own holdings and quotes around a fixed 50-cent anchor. The generator's reference probabilities are evaluator inputs; the inventory policy does not estimate probability. The informed regime therefore tests inventory control under stale value estimates. Positive or negative profits depend on this stipulated willingness distribution, information structure and execution mechanism.

Each path has its own seed and an independent seeded terminal draw with YES probability equal to its final reference probability. The draw and path are identical for paired strategies. `paths.json` preserves all arrivals, final probabilities, outcomes and hashes. Quotes are evaluated with the actual service, not with an assumed fill probability.

## Development and held-out evaluation

The design in `model.mjs` is fixed before the full run:

- Development: 6 seeds × 3 regimes = 18 paths; baseline and all 3 inventory parameters = 72 episodes.
- Evaluation: 16 fresh seeds × 3 regimes = 48 paths; baseline and selected inventory parameter = 96 episodes.
- Total: 168 episodes, each with 60 arrivals.
- Development seed ranges start at 10000, 11000 and 12000; evaluation ranges start at 100000, 101000 and 102000.

Select one inventory parameter using the equally weighted development mean of:

```text
score = terminal reference-value P&L in dollars
        - 0.02 × time-average absolute inventory in contracts
```

The coefficient is an explicitly chosen experiment preference: a one-contract reduction in average imbalance is worth two cents in this score. It is not a transaction fee or an estimated economic parameter. Ties select the smaller parameter. `selection.json` is saved before evaluation paths are generated. The fixed baseline is a comparator, not an inventory candidate. All development rankings remain visible.

Evaluation seeds are held out from parameter selection under the same generator families. This is a synthetic holdout, not a historical market backtest. Revisions following inspection of these evaluation results require a new, separately labelled evaluation set.

## Valuation

Let `QY`, `QN` be final YES and NO holdings, `C` total executed principal plus fees in dollars, `p` the common final reference probability and `Y` the common binary final outcome.

```text
Reference-value P&L = QY × p + QN × (1 - p) - C
Terminal-outcome P&L = QY × Y + QN × (1 - Y) - C
P&L if YES = QY - C
P&L if NO = QN - C
Worst-outcome P&L = min(QY, QN) - C
```

One winning contract pays one virtual dollar in the evaluator. Reservations are fully released at the end of every step. Unspent initial capital cancels out when expressing P&L, and executed fees are subtracted once. Reference-value P&L is an expected payout under the generator's terminal probability, not a liquidation price or cash received.

The service executes at its current 25 bps fee. Episode records also revalue identical executed fills at 0 and 50 bps to show fee sensitivity; these are accounting sensitivities without rerunning execution or reservation decisions.

## Metrics and uncertainty

Primary risk metric: time-average absolute net inventory. Also report maximum absolute inventory, terminal inventory, execution rate, principal deployed, fees, terminal P&L, reference-value P&L and worst-outcome P&L. Fill rate is provider contracts executed divided by total incoming contracts offered, including non-crossing arrivals.

For each regime, compare the two policies on the same 16 evaluation paths. Report mean paired differences with 2,000 whole-episode paired bootstrap resamples and 95% percentile intervals. No individual arrival is counted as an independent experiment. Intervals are exploratory and conditional on this generator and the development-selected parameter; they exclude parameter-selection uncertainty and do not imply real-market profitability.

The inventory figure always uses the first evaluation seed in each regime, selected by rule before results. All other paths remain in the CSV.

## Verification

Per arrival, assertions check actual filled quantity against quoted price/quantity, maker principal and fees, the inventory cap, released reservations, and each account's $1,000 cash conservation. Per episode, assertions check matched pair principal, total fees, volume, position reconciliation and the two-account accounting state. Paired comparisons assert equal path hashes and final outcomes.

Unit tests cover deterministic replay, symmetric quote responses, prospective inventory caps, binary payout arithmetic, fee treatment, rejection of evaluation data during selection, and paired bootstrap behavior. Trading regressions run before the full experiment.

## Reproduce

On the `inventory-strategy` branch, use Node.js 22.14.0 as configured in the workflow:

```sh
npm ci
node --experimental-strip-types --test tests/inventory-strategy.test.mjs tests/day11.test.mjs tests/day12.test.mjs tests/market-prices.test.mjs
node experiments/inventory-strategy/run.mjs --smoke
node experiments/inventory-strategy/run.mjs
```

Smoke uses fewer paths and writes to `smoke-results/`; it is an engineering check, not the full reported experiment. Full outputs go to `experiments/inventory-strategy/results/`:

- `results.json`: config, selection, environment, source hashes, summary and episode metrics.
- `paths.json`: all development/evaluation orders and terminal outcomes.
- `selection.json`: frozen development decision and candidate scores.
- `episodes.csv`: per-episode results and fee sensitivities.
- `trajectories.csv`: per-arrival evaluation inventories, quotes and reference P&L.
- `report.md`: tables, differences and interpretation.
- `inventory.svg`: three preselected example inventory paths.

The GitHub Actions workflow adds `run.log`, publishes the report in its summary and retains the artifact for 30 days. Preserve a completed run's raw outputs under a commit-labelled results directory when publishing the study.

Only experiment files, tests, documentation and a workflow are added. The experiment uses no production credentials and performs no remote D1 writes or website deployment. The simulator assumes instant, free quote cancellation, no competing providers and an exogenous order stream. Its contribution is a reproducible risk–execution–value comparison under declared conditions.
