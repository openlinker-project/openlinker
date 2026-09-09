| probe | n | mean (ms) | median (ms) | stdev (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| P1 auth-fail | 300 | 6.188 | 5.989 | 1.862 | 7.856 |
| P2 decode-reject | 300 | 3.879 | 3.883 | 0.739 | 4.761 |
| P3 routable-product | 300 | 7.098 | 7.068 | 1.358 | 9.915 |
| P4 routable-order | 300 | 7.968 | 7.931 | 0.984 | 9.764 |

### Stage deltas

| delta | median delta (ms) | 90% bootstrap CI (ms) | distinguishable from noise? |
|---|---:|---|---|
| P3 - P2 (routing + two Redis calls + delivery INSERT) | 3.185 | [3.076, 3.289] | yes |
| P4 - P3 (sync_jobs INSERT, same transaction) | 0.863 | [0.705, 0.990] | yes |

P1 auth-fail, reported alone (unauthenticated cost, also the attack surface #2842 flags): median 5.989 ms, mean 6.188 ms, n=300, stdev 1.862 ms
