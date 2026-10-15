# Day 19 — outcome evidence and settlement preview

Administrators use `/admin/resolutions` to select a closed event, propose YES, NO or VOID with an HTTPS evidence link and written rationale, then review and confirm the exact saved proposal. The same administrator may perform both stages; this is not independent two-person approval. Final results cannot be edited through the application. Evidence is entered by the administrator and is not automatically verified.

Proposals record the event revision, original rules, source, deadline and settlement policy. Conditional writes reject early decisions, stale event/proposal revisions and changes to final results. Durable request IDs, action receipts and audit records share one transaction; retries do not create another decision. Proposal revisions remain in the immutable action history.

Published event pages show only final decisions and evidence. Signed-in active accounts with filled practice holdings can calculate their own estimated settlement. A winning contract estimates $1, a losing contract $0; VOID estimates return of principal and paid practice fees. Calculations use exact integer units, including migrated fee amounts. Archived events remain available only to owners of relevant holdings through this preview endpoint.

This release applies no payouts, refunds, cash credits or holdings redemption. Existing practice cash and reconciliation remain unchanged. Real-money funding, trading and settlement are disconnected.

Validation: 177 automated tests passed; TypeScript checking and production build passed. Local Workers/D1 HTTP checks passed for authentication, administrator access, CSRF rejection, public final-result visibility, account-specific YES/NO/VOID estimates and unchanged cash. Only disposable local fixtures were used and removed.

Deployment status: local implementation and build complete. Publishing is pending because the execution policy rejects the workflow's required stdin input after network permissions are granted. No Day 19 production deployment has been confirmed.
