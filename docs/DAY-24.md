# Day 24 — local security hardening

Local-only; no deployment or production database changes. This is focused hardening, not a penetration test or a declaration that the app is production-secure.

## Implemented

Persistent fixed-minute quotas keyed by SHA-256(scope + verified Google subject), shared across that user's sessions. Limits: administrator mutations 20/minute; practice order/match/sell mutations 60/minute; cancellation endpoints a separate 60/minute; account/profile, watchlist, funding requests and notification/trade-event synchronization share 30/minute. The practice grant endpoint uses the latter group. Source checks occur before quota consumption; invalid authenticated request bodies may consume quota. Counts are capped using one conditional SQL upsert; they cannot exceed the quota through concurrent requests. Expired counters are removed in batches of up to 100 on later requests. There is no background cleanup task. Fixed-window boundaries permit adjacent-window bursts.

Rate rejections return 429 and Retry-After: 60. A rejected call makes no downstream application mutation. Failed limiter storage causes the handler to fail closed. GET reads and logout remain available. Cancellation is isolated from order/sync quotas, but still has its own limit. Quota rejection does not cancel or reverse a previously accepted request.

A shared streamed request-body reader rejects more than 16 KiB before buffering the full payload. Existing smaller per-handler limits remain. Content-Length is an early rejection hint, not trusted to enforce the cap. Quote, order-preview and mutation handlers use the reader. JSON content types now match the exact media type (case-insensitive, optional charset), rejecting misleading application/json-* prefixes.

## Existing protections reviewed

Google OAuth flow includes PKCE, nonce, expiring one-use state and browser binding. ID-token verification checks issuer, audience, algorithm, expiry and verified email. Session tokens are hashed in storage; cookies are HttpOnly/SameSite=Lax and Secure with __Host prefix on HTTPS. Callback logs use fixed diagnostic labels rather than raw credentials/errors. Administrator authorization uses the active configured account ID; owned records derive identity from the session. Origin checks and strict request schemas remain in place. No authentication bypass or credentials were added.

## Validation

200 automated tests passed, TypeScript passed, local production build passed. New tests cover exact quota thresholds, shared endpoint budgets, user/cancel isolation, window rollover, concurrent quota enforcement, database failure, UTF-8 byte limits, oversized streams and exact content type/origin checks. Local Workers/D1 HTTP verification confirmed persistent 429 rejection, accessible reads/cancellation, unaffected other accounts and 413 oversized anonymous quote requests. Synthetic account and trade fixtures were removed. Hashed quota counters expire through bounded cleanup.

Migration 0016_curious_stardust.sql adds request_limits and was applied only locally.

## Remaining limits

Anonymous OAuth-start/callback traffic and public GET reads do not yet have edge/IP rate limiting. A valid multi-account attacker can distribute requests; this is not DDoS protection. No distributed load test, external security audit or complete secret scan was performed. Browser user-facing retry countdown is not included; the server returns wait text and Retry-After. Local Google credentials remain absent, so real-account local sign-in is still unverified. Existing publication rule locks, practice-only finances and authentication requirements remain unchanged.
