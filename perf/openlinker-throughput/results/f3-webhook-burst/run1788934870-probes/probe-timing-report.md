| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 6.998 | 6.459 | 4.685 | 17.266 |
| P2 decode-reject | 300 | 2.463 | 2.356 | 0.463 | 3.218 |
| P3 routable-product | 300 | 18.592 | 14.608 | 10.821 | 43.674 |
| P4 routable-order | 300 | 11.716 | 10.191 | 5.293 | 23.548 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 12.253 | [10.944, 14.055] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | -4.417 | [-6.240, -3.126] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 6.459 ms, mean 6.998 ms, n=300, stdev 4.685 ms
