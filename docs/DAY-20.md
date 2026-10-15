# Day 20 — local practice controls and administrator audit log

Implemented locally only; no source push, deployment or production database mutation was attempted.

`/admin/operations` provides global practice pause/resume with an explicit confirmation, required internal reason, optimistic revision check and durable request ID. The state and audit receipt commit together. A retry returns the recorded result; conflicting request reuse or stale changes fail. Only the configured active administrator can access the log or change the control.

A pause blocks new practice buys, sell reservations and matching. The actual INSERT/ matching candidate SQL rechecks the pause inside each write transaction, including when the pause occurs after an initial eligibility check. Existing reservations are retained. Viewing, cancellation and ordinary expiry releases remain available; resume does not automatically run matching. Account-specific restrictions remain available separately at `/admin/eligibility`. Real trading remains disconnected.

The read-only audit browser shows 25 records per page with exact action and entity-ID filters. Actor, timestamp, reason, correlation ID and saved details are displayed only to the administrator. It includes earlier account/event/provider/outcome audit entries, not every trade-ledger event. Public `/api/operations` exposes only the paused boolean. Practice and event pages refresh a status notice every 30 seconds; server checks remain authoritative. An unavailable status is not represented as trading open.

Migration: `0014_gray_vin_gonzales.sql` adds `practice_control`. Applied only to the local D1 database. No production migration was run.

Validation: 186 automated tests passed, including access denial, pause/resume replay, stale requests, audit rollback, order rejection, cancellation during pause, resume, sell rejection, audit pagination and a pause between eligibility check and insertion. TypeScript and local production build passed. Local HTTP checks confirm status output, rendered pages, and anonymous read/write denial for administration.

Known limitation: Google OAuth credentials are still absent locally. The actual user cannot yet sign in to the local administrator screen. Protected behavior was verified with synthetic identities in isolated tests, not a bypass or a real user session. Local OAuth setup remains separate work; no administrator impersonation was added.
