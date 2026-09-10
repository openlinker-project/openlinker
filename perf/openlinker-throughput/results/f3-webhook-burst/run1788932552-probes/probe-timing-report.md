| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 6.153 | 5.835 | 3.811 | 7.261 |
| P2 decode-reject | 300 | 4.014 | 3.925 | 0.829 | 5.195 |
| P3 routable-product | 300 | 7.512 | 7.306 | 1.159 | 9.897 |
| P4 routable-order | 300 | 8.249 | 7.920 | 1.148 | 10.422 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.381 | [3.288, 3.501] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | 0.614 | [0.479, 0.707] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 5.835 ms, mean 6.153 ms, n=300, stdev 3.811 ms
