| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 6.375 | 6.162 | 2.138 | 8.108 |
| P2 decode-reject | 300 | 3.976 | 3.882 | 0.810 | 5.224 |
| P3 routable-product | 300 | 7.323 | 7.497 | 1.237 | 9.111 |
| P4 routable-order | 300 | 8.061 | 8.175 | 1.268 | 9.963 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.615 | [3.385, 3.837] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | 0.678 | [0.574, 0.822] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 6.162 ms, mean 6.375 ms, n=300, stdev 2.138 ms
