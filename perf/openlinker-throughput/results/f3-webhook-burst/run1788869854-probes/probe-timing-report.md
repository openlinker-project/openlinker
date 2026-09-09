| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 5.818 | 5.808 | 2.046 | 7.950 |
| P2 decode-reject | 300 | 4.081 | 4.089 | 0.830 | 5.301 |
| P3 routable-product | 300 | 7.496 | 7.362 | 1.066 | 9.489 |
| P4 routable-order | 300 | 7.868 | 7.724 | 1.079 | 9.569 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.272 | [3.141, 3.377] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | 0.362 | [0.213, 0.493] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 5.808 ms, mean 5.818 ms, n=300, stdev 2.046 ms
