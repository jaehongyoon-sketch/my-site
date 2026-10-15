# Day 6 — Exchange connection administration

Entry: Account → Manage accounts → Manage exchange connections (`/admin/providers`). Only the active account identified by the server's ADMIN_ACCOUNT_ID may read or change these records. Google identity is resolved on the server; client-supplied actor/account identifiers are rejected.

## Delivered
- Separate Kalshi sandbox and live records; absent records display as unapproved without writes on page load.
- Not approved, Sandbox testing, Approval recorded, Suspended statuses. Live cannot enter sandbox testing.
- Every saved review requires a reason. Approval recorded also requires an agreement/approval reference. This records an administrator's statement; it does not independently verify or obtain exchange authorization.
- D1 persists state and an audit entry in a single atomic batch. The audit contains previous/new status, reason, reference, administrator, UTC timestamp and increasing revision. The latest 20 entries are visible. No history editing or deletion endpoint exists.
- Compare-and-swap on audit revision rejects stale writes with HTTP 409, including a repeated save following a lost response. Reload before retrying; never blindly overwrite.
- Private no-store APIs, active admin authorization, strict request schema and same-origin mutation checks.

## Capability boundary
The production source remains the demo adapter. The registry owns source selection on the server. An approval record cannot select an adapter, modify endpoints or enable orders. The capability gate rejects unknown providers/environments, suspended/unapproved external connections, live testing, and unimplemented capabilities. Kalshi's low-level read client exists but is not registered as an active market adapter. Sandbox testing is a review status, not a simulated exchange account. The order endpoint still always returns 503 with no execution.

Future activation needs a reviewed market adapter, explicit environment mapping, an activation workflow enforcing the persisted approval at request time, and applicable exchange authorization. Order execution and funding need separate capabilities and account eligibility checks. The 0.25% estimate is unchanged; no fees are collected.

## Verification
73 automated tests cover existing behavior and seven new connection-management cases: default denial, administrator access, persisted audit, stale updates, validation/evidence, transaction rollback, and capability denial across statuses/environments. Type checking and production build are also required before publication. Local HTTP tests exercise only synthetic accounts and sessions, never production authentication records.
