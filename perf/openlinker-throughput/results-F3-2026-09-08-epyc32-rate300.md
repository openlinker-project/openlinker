# F3 - webhook ingress burst throughput

_generated 2026-09-08T12:16:38Z, run group run1788868755_

## Differential probes (P1-P4)

```
mode,http_status,eventId,webhook_deliveries_status
auth-fail,401,auth-fail-1788868755677,<none - auth-fail/decode-reject never reach webhook_deliveries>
decode-reject,400,decode-reject-1788868755803,<none - auth-fail/decode-reject never reach webhook_deliveries>
routable-product,202,routable-product-1788868755927,deadlettered
routable-order,202,routable-order-1788868756054,job_enqueued
```

### Timed differential probes (#2929)

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

### pg_stat_statements corroboration (#2929)

pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
67354|0.112|7535.361|INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "rece
66751|0.127|8506.585|INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttemp
59294|0.053|3150.796|UPDATE webhook_deliveries
          SET "status" = $6,
              "downstreamJobId" = $1,
              "downstreamJobType" = COALESCE($2
53628|0.050|2694.765|SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1
320|0.668|213.728|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2
160|1.504|240.601|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2 AND "nextRunAt"<=NOW()
159|0.087|13.873|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2 AND "nextRunAt">NOW()
16|2.225|35.592|DELETE FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
14|2.734|38.270|DROP TABLE IF EXISTS _perf_sync_jobs_snapshot
14|21.156|296.188|SELECT COUNT(*) FROM sync_jobs
10|0.852|8.522|SELECT status FROM webhook_deliveries WHERE "eventId"=$1 AND "connectionId"=$2
10|1.003|10.027|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status IN ($2,$3)
7|8.868|62.078|CREATE TABLE _perf_sync_jobs_snapshot AS
    SELECT id, attempts, status, "lockedAt" FROM sync_jobs WHERE "connectionId" IN ($1)
7|2.138|14.965|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND "createdAt">=$2 AND "deferredTotalMs" IS NOT NULL AND "deferredTotalMs">$3
7|2.135|14.942|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND "createdAt">=$2 AND attempts>$3

```

## Arms

### unique

- verdict: `VALID`
- requests (measured, n=42749): 42749 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

### replay-committed

- verdict: `VALID`
- requests (measured, n=42749): 42749 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

### replay-concurrent

- verdict: `VALID`
- requests (measured, n=42749): 42749 total, 0 non-2xx (ratio 0.0)
- deadlocks delta (measured): 0

## What this did not establish

- No cross-run repeat/agreement check (#2845 owns that policy).
