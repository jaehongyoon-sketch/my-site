# Day 21 — practice fee statement and release rules

Local-only implementation. No hosting/source upload or production mutation attempted. No schema migration required.

Added `/practice/fees`, linked from the practice portfolio and funds/activity page. The page explains the existing 0.25% per-filled-contract policy with an exact $0.60 → $0.0015 example. Display preserves six dollar decimal places as needed for 1/400-cent accounting units. It separates actual charged practice fees and principal from recorded held funds and released unused reservations. Release amounts include price-improvement releases and recorded cancellation/expiry releases, never the initial grant.

The private `/api/practice/fees?page=0` endpoint requires an active authenticated app profile, rejects unknown filters and invalid pages, and scopes all records to that account. Entries and all-history totals come from one database batch snapshot. Per-order receipts are aggregated before joining cash releases to avoid multiplying multi-fill or multi-release sums. Twenty-five entries per page; totals cover all orders. It reads existing receipts rather than recalculating historical fees under the current policy.

Cancellation costs nothing extra. Existing fill fees are retained, and only unused reservations are released. Sell reservations are not executions and incur no execution fee. VOID resolution is still only an estimate: no actual fee refund, settlement credit or redemption exists. Real revenue is zero; these are virtual practice charges. This report does not trigger expiry processing or mutate cash. The page labels held funds as recorded and points to the portfolio for lifecycle refresh.

Validation: 191 automated tests passed, TypeScript passed, production build passed. New tests cover empty/inactive accounts, isolation, partial fill + cancellation, exact sub-cent fees, price improvement, unfilled cancellation, pagination-independent totals, multiple fills and legacy rounded fee receipts. Local HTTP checks used disposable authenticated fixtures and verified exact totals, ownership, anonymous denial, rejected forged filters and page rendering; fixtures removed afterward.

Local Google login remains unconfigured. Fee rules are publicly viewable locally, but real-user fee history requires local OAuth configuration. No authentication bypass was introduced.
