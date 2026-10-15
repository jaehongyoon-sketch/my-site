# Day 7 — Own events

## Administrator workflow
Open `/admin/events` from Administration. Enter a question, category, closing date/time in UTC, resolution rules and an HTTPS reference source. Save a draft or publish directly. Drafts can be edited or archived. Published event terms are immutable; archive removes the event from the public catalog. Archiving is not resolution or settlement. Audit rows record the actor, revision and state transition. Stale revisions are rejected. Creating with the same UUID twice does not duplicate an event.

The public home page queries D1, supports literal title search, category and upcoming/closed filters, and 12-item pagination. Expired published events appear under Closed; they do not imply a resolved result. Drafts and archived events are excluded from public APIs and details. No events are seeded in production. Saved events are scoped to the active Google-linked profile and reachable from My saved events.

## Name changes
- Initial creation is not a rename. Existing users have no retroactive lock.
- A changed name starts a 604,800,000 ms server-enforced interval. Exact expiry is allowed.
- A trimmed, unchanged name does not extend the interval.
- Only the configured active administrator ID bypasses the limit; email and client role values do not confer privileges.
- The account screen shows the next available date in the browser's local timezone. Reload after that time to update the control.
- The cooldown survives deactivation. The previous name is compared by hash for reactivation without keeping a plaintext copy of the cleared name in the cooldown record. Restoring that same name preserves the interval; choosing another must satisfy it. An active account cannot use the reactivation action.
- Atomic conditional writes enforce the limit even if browser controls are bypassed.

## Scope and validation
The old Kalshi read client and sample adapter are inactive historical code. The catalog, details and saved-event flow use own_events. `/api/quotes` and `/api/orders` return 503; no prices, funds, or execution are fabricated. The 0.25% calculation remains covered by existing domain tests but no fees are collected.

Append-only migration 0004 adds own_events and name_change_limits. Prior tables/data remain intact. Tests cover cooldown boundaries, admin exemption, reactivation, public visibility, revisions, atomic rollback, search escaping, pagination, saved events and invalid inputs. Local HTTP checks use synthetic accounts only. Production OAuth tokens are not inspected.

## Visibility recovery
Archived means hidden, not published. Administrators can republish archived events before their original closing time. Republishing preserves the stored question, source, rules and deadline. Stale revisions and expired original deadlines are rejected. Hiding now requires an explicit confirmation, and status labels explain home-page visibility. Save results distinguish drafts, published events and hidden events.
