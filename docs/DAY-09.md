# Day 9 — Own-event order intent and server review

Event detail pages now provide **Plan a limit buy**. A signed-in active Event profile can choose YES/NO, a limit price of 1–99 whole cents and 1–10,000 whole contracts, then request a server cost review. No default price is supplied. The chosen limit is explicitly not a current market quote.

## Request contract
`POST /api/order-previews` accepts only eventId, eventRevision, side=buy, orderType=limit, timeInForce=until-close, outcome, limitPriceCents and quantity. JSON strings are not coerced into numbers. Additional identity, environment, balance, total or fee fields are rejected. Request bodies are bounded to 2,048 characters. Same-origin JSON requests and a valid Google app session are required. Responses are private/no-store with Vary: Cookie.

The server resolves the active profile from the verified Google subject. Missing/closed/suspended profiles are denied. Only published own_events records can be reviewed. Unknown/draft/archived records return 404. A changed event revision returns 409 and requires a page reload. A malformed or reached closing time returns 409. Admins have no bypass for these order checks.

## Calculations and expiry
The shared integer-cent calculator computes contract cost = limit price × quantity, fee = cost × 0.25% rounded half-up once per order, and total = cost + fee. The review also displays the hypothetical $1-per-winning-contract payout and net gain. It assumes every contract fills at the requested limit, not that a fill will happen. Losing the full cost and fee is disclosed. Balances, funding and trading eligibility are explicitly unverified.

Each review includes a random preview ID, the exact normalized intent, server check time, the original event deadline and an expiry of min(server time + 60 seconds, event close). The ID is not a signed authorization, idempotency key or order ID. The response always has mode=review_only, priceBasis=user_limit and executable=false. No database writes, reservations, fees or order submissions occur.

Changing inputs removes the old review. The UI expires reviews using monotonic elapsed time, conservatively accounting for request time. Leaving the tab or going offline invalidates a review. Timeouts preserve inputs and show a retry message. There is no enabled submission button. `/api/orders` continues to reject all execution requests.

## Verification
94 automated tests passed (the Worker runtime test required local network permission before its successful rerun). Six new tests cover totals/fees, strict inputs, account access, event privacy/revisions, exact deadline/expiry, both outcomes and maximum values. Local HTTP checks exercise authentication, calculations, private caching, forged totals, origins, suspension, changed/closed/archived events and absence of stored orders. Synthetic local records only; no production order or account mutations.

## Day 10 handoff
Implement separately authorized mock-funds order acceptance and duplicate-request protection. A future acceptance endpoint must re-read account/event/revision/deadline/eligibility/funds and independently recompute amounts inside its acceptance transaction; it must never trust this review or a client-supplied preview ID as permission to execute. Actual execution, matching, sell orders and settlement remain future work.
