# Day 22 — local in-app practice notifications

Completed locally; no source push, deployment or production database changes.

`/notifications` lists owned practice order acceptance, buy fills, unused buy reservation releases, sell reservations and sell reservation releases. Sell reservations are explicitly labeled as not executed. Users can mark individual notices as read, see an all-page unread count, paginate 25 notices per page and toggle in-app collection. A link is available in the practice portfolio.

Collection is manual through **Sync notifications**, not automatic background delivery. Each request collects up to 100 missing source trade records and projects up to 100 notices. Continue sync appears while work remains. Stable source IDs prevent duplicate notices on retries. Refresh only reads existing notices. No email, push notification, external messaging or money movement is performed.

Settings apply at collection time: records synchronized while off are stored as permanently suppressed, so re-enabling does not re-deliver those records. Previously visible notices remain visible. Records not yet synchronized are evaluated using the setting at their eventual collection. This is not a transaction-time opt-out or an automated delivery service; the UI describes these semantics explicitly.

The API requires an authenticated active profile, checks mutation origin, rejects unknown filters and request fields, and derives ownership from the session. Read marking is repeatable without changing its first timestamp. Settings use revision checks to reject stale writes. A timed-out settings request is resolved by refreshing before retrying. One user's notification IDs cannot be read-marked by another user.

Migration `0015_wise_marauders.sql` adds `notification_settings` and `notifications`. Applied only to local D1.

Validation completed: 195 automated tests passed, TypeScript checking passed, production build completed. Local HTTP checks verified login requirements, account isolation, origin checks, sync deduplication, read marking, setting conflicts and rendered notification page. Disposable test data was removed. Funds were unchanged during collection and read operations.

Limitation: local Google OAuth remains unconfigured. Real-user notification history/settings cannot be exercised in the local UI until login is configured. Authenticated behavior was tested with isolated synthetic identities, without adding an authentication bypass. Outcome alerts, email, push and background scheduling are not included.
