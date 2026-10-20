# Event — Prediction Market & Matching Engine

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

https://studio.youtube.com/video/yHVU8Il0_k4/edit

## Overview

Event connects the lifecycle of a prediction-market order: submission, fund reservation, matching, execution, and portfolio valuation.

Participants express a view through YES or NO limit orders. Compatible orders from different accounts form matched contracts, and completed trades establish the market’s observed price.

The system maintains a clear distinction between:

- **Limit price:** the maximum price a participant is willing to pay.
- **Executable quote:** the price available against an eligible opposing order.
- **Last-traded price:** the price of the most recent completed trade.
- **Position value:** holdings valued using the latest observed execution price.

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

Eligible orders are processed by price priority, followed by registration order. The resting order executes at its limit price; the incoming order pays the complementary price.

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

The recorded local validation run completed **210 passing tests** across the project.

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
