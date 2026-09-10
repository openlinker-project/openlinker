# F3 - webhook ingress burst throughput

_generated 2026-09-08T12:35:02Z, run group run1788869854_

## Differential probes (P1-P4)

```
mode,http_status,eventId,webhook_deliveries_status
auth-fail,401,auth-fail-1788869854366,<none - auth-fail/decode-reject never reach webhook_deliveries>
decode-reject,400,decode-reject-1788869854496,<none - auth-fail/decode-reject never reach webhook_deliveries>
routable-product,202,routable-product-1788869854629,deadlettered
routable-order,202,routable-order-1788869854755,job_enqueued
```

### Timed differential probes (#2929)

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

### pg_stat_statements corroboration (#2929)

pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
239985|0.117|28048.970|INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "rece
239081|0.133|31694.337|INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttemp
189843|0.052|9914.394|UPDATE webhook_deliveries
          SET "status" = $6,
              "downstreamJobId" = $1,
              "downstreamJobType" = COALESCE($2
150293|0.048|7256.075|SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1
644|0.605|389.706|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2
322|4.059|1307.095|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2 AND "nextRunAt"<=NOW()
321|0.090|28.775|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2 AND "nextRunAt">NOW()
31|4.456|138.147|DELETE FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
28|21.289|596.089|SELECT COUNT(*) FROM sync_jobs
28|2.832|79.308|DROP TABLE IF EXISTS _perf_sync_jobs_snapshot
18|2.119|38.144|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
15|3.670|55.054|SELECT status FROM webhook_deliveries WHERE "eventId"=$1 AND "connectionId"=$2
14|3.530|49.425|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND "createdAt">=$2 AND "deferredTotalMs" IS NOT NULL AND "deferredTotalMs">$3
14|3.647|51.063|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND "createdAt">=$2 AND attempts>$3
14|10.232|143.251|CREATE TABLE _perf_sync_jobs_snapshot AS
    SELECT id, attempts, status, "lockedAt" FROM sync_jobs WHERE "connectionId" IN ($1)

```

## Arms

### unique

- verdict: `VALID`
- requests (measured, n=85499): 85499 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

### replay-committed

- verdict: `VALID`
- requests (measured, n=85499): 85499 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

### replay-concurrent

- verdict: `VALID`
- requests (measured, n=85499): 85499 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

## What this did not establish

- No cross-run repeat/agreement check (#2845 owns that policy).
