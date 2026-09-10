| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 5.978 | 5.910 | 2.121 | 7.734 |
| P2 decode-reject | 300 | 3.379 | 3.091 | 0.764 | 4.928 |
| P3 routable-product | 300 | 6.840 | 6.600 | 1.348 | 8.755 |
| P4 routable-order | 300 | 7.541 | 7.376 | 1.489 | 9.852 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.509 | [3.214, 3.820] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | 0.776 | [0.242, 1.554] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 5.910 ms, mean 5.978 ms, n=300, stdev 2.121 ms
