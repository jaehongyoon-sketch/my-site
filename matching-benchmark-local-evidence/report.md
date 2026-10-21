# Local benchmark verification

Engine source commit: `c77840a5515b5d66cb2ed229dd792dd19c0264d1`

Environment: Apple M5 / macOS arm64 / Node v24.19.0 / SQLite 3.53.3

270 recorded measurements passed; 45 warmups also checked. Matching/cancellation/market regression tests: 24 passed, 0 failed. Existing dependency lockfile matches the local installed project; esbuild and zod versions checked. GitHub workflow has not yet been executed. No production deployment or performance change was made.

| Scenario | Resting orders | Initial median ms | Completion median ms | Completion p95 ms |
|---|---:|---:|---:|---:|
| no-match | 10 | 0.250 | 0.250 | 0.421 |
| single-fill | 10 | 0.413 | 0.413 | 0.537 |
| eight-fills | 10 | 0.860 | 1.802 | 1.936 |
| no-match | 100 | 0.592 | 0.592 | 0.631 |
| single-fill | 100 | 1.487 | 1.487 | 1.549 |
| eight-fills | 100 | 3.768 | 7.537 | 8.029 |
| no-match | 1000 | 32.885 | 32.885 | 33.345 |
| single-fill | 1000 | 98.004 | 98.004 | 111.194 |
| eight-fills | 1000 | 261.692 | 521.439 | 526.741 |

Eight-fill samples all completed four fills initially and four in one continuation call. Growing processing times warrant query-plan investigation; these three book sizes do not establish asymptotic complexity. This is warm, sequential in-memory SQLite service timing, not Cloudflare D1, HTTP latency or production throughput.
