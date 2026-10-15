# Event — partnership review brief

Draft for review; not submitted. Event is a working product name. Legal entity, jurisdiction, launch geography, and founder contact details will be supplied before submission.

## Proposed product

A solo developer is building an English, mobile-friendly web application for eligible US customers to discover and potentially trade prediction-market contracts listed on an existing exchange. The proposed settlement currency is USD. We seek guidance on whether Kalshi supports this model and which agreement, permissions, and integration path would apply.

The current private prototype includes synthetic market discovery, contract rules, a quantity-based indicative order preview, and sample watchlists. All prices and charts are synthetic. There are no customer accounts, deposits, live quotes, orders, revenue, or active exchange partnerships. Server-side order submission is disabled.

## Proposed allocation of responsibilities

Subject to Kalshi's approval, we would prefer exchange-held customer accounts and funds, with the exchange or its authorized providers handling custody, execution, settlement, eligibility verification, and money movement. The app would provide discovery, customer-facing presentation, and an approved account-access experience. This allocation is a proposal, not an agreed arrangement; registration requirements and support responsibilities remain to be determined.

We do not plan to collect raw private keys, banking credentials, or identity documents in the prototype. We need an approved authorization mechanism before acting for customers. A public market-data endpoint or an individual member API key would not be treated as permission to operate a multi-user trading application.

## Technical readiness

The code separates sample market data from future exchange connections. It includes USD integer-cent sample calculations, an initial relational data model, order and transfer state transitions, and tests for reconciliation and account isolation rules. A read-only Kalshi market-list/detail connector has been implemented against published documentation using synthetic tests; it is not active and has not fetched live market data. Its price representation preserves fractional-cent precision.

Authentication, persistent runtime storage, approved real-time data display, customer authorization, production order execution, monitoring, and operational reconciliation are still future work. The 30-day development plan targets a testable integration foundation; it is not a promised date for regulated production launch.

## Commercial proposal to discuss

Potential revenue models include an approved referral arrangement or permitted subscription features. We have not set fees, assumed revenue sharing, or added transaction charges. We need written confirmation of allowed monetization, customer disclosures, data licensing, minimum commitments, and per-account or per-request costs before selecting a model.

## Requested next step

Please identify the appropriate data and platform partnership path, any required legal or operational role, eligibility prerequisites, pricing, and a sandbox or technical evaluation process. We can provide a private prototype walkthrough and architecture notes on request.
