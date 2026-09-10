# F3 - webhook ingress burst throughput

_generated 2026-09-08T11:57:54Z, run group run1788867635_

## Differential probes (P1-P4)

```
mode,http_status,eventId,webhook_deliveries_status
auth-fail,401,auth-fail-1788867635941,<none - auth-fail/decode-reject never reach webhook_deliveries>
decode-reject,400,decode-reject-1788867636051,<none - auth-fail/decode-reject never reach webhook_deliveries>
routable-product,202,routable-product-1788867636163,deadlettered
routable-order,202,routable-order-1788867636282,job_enqueued
```

### Timed differential probes (#2929)

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

### pg_stat_statements corroboration (#2929)

pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
613|0.140|85.638|INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "rece
311|0.161|49.929|INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttemp
5|0.060|0.298|SELECT status FROM webhook_deliveries WHERE "eventId"=$1 AND "connectionId"=$2
2|0.127|0.253|DELETE FROM sync_jobs WHERE status IN ($1,$2) AND "jobType"=$3
2|0.128|0.256|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
1|0.550|0.550|DELETE FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
1|0.196|0.196|SELECT "jobType", status, COUNT(*), min("createdAt") AS first, max("createdAt") AS last
 FROM sync_jobs WHERE status IN ($1,$2) GROUP BY 1,2
1|0.078|0.078|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "status" = $4 AND "lockedAt" <
1|0.004|0.004|UPDATE sync_jobs SET "maxAttempts"="maxAttempts" WHERE $1=$2
1|0.093|0.093|SELECT COUNT(*) FROM webhook_deliveries WHERE "connectionId"=$1
1|0.101|0.101|SELECT COUNT(*) FROM sync_jobs WHERE status IN ($1,$2)

```

## Arms

### unique

- verdict: `VALID`
- requests (measured, n=7124): 7124 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

### replay-committed

- verdict: `VALID`
- requests (measured, n=7124): 7124 total, 1 non-2xx (ratio 0.00014037057832678272)
- deadlocks delta (measured): 0

### replay-concurrent

- verdict: `VALID`
- requests (measured, n=7124): 7124 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

## What this did not establish

- No cross-run repeat/agreement check (#2845 owns that policy).
