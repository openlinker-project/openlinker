# F3 - webhook ingress burst throughput

_generated 2026-09-09T06:00:02Z, run group run1788932552_

## Differential probes (P1-P4)

```
mode,http_status,eventId,webhook_deliveries_status
auth-fail,401,auth-fail-1788932552826,<none - auth-fail/decode-reject never reach webhook_deliveries>
decode-reject,400,decode-reject-1788932552954,<none - auth-fail/decode-reject never reach webhook_deliveries>
routable-product,202,routable-product-1788932553066,deadlettered
routable-order,202,routable-order-1788932553193,job_enqueued
```

### Timed differential probes (#2929)

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

### pg_stat_statements corroboration (#2929)

pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
226863|0.223|50622.702|SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2 AND "jobType" = ANY($3)
        ORDER BY "nextRunAt" ASC
        LIM
173539|0.117|20269.828|INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "rece
172937|0.129|22299.645|INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttemp
130826|0.051|6670.093|UPDATE webhook_deliveries
          SET "status" = $6,
              "downstreamJobId" = $1,
              "downstreamJobType" = COALESCE($2
96960|0.048|4614.524|SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1
12971|0.049|635.800|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
9598|0.411|3943.349|SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2 AND "jobType" = ANY($3) AND "connectionId" != ALL($4)
        ORDER 
8348|0.118|985.070|INSERT INTO "sync_jobs"("id", "jobType", "connectionId", "payloadJson", "status", "outcome", "outcomeReason", "idempotencyKey", "attempts", 
7867|0.071|556.786|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
7866|0.168|1320.876|UPDATE "sync_jobs" SET "status" = $1, "attempts" = $2, "nextRunAt" = $3, "lockedAt" = $4, "lockedBy" = $5, "lastError" = $6, "lastAttemptDur
5549|0.202|1120.023|UPDATE "sync_jobs" SET "status" = $1, "nextRunAt" = $2, "lockedAt" = $3, "lockedBy" = $4, "lastError" = $5, "updatedAt" = CURRENT_TIMESTAMP 
5061|0.194|982.355|UPDATE "sync_jobs" SET "status" = $1, "outcome" = $2, "outcomeReason" = $3, "lockedAt" = $4, "lockedBy" = $5, "lastError" = $6, "lastAttempt
4605|0.181|835.085|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4)
2543|0.081|204.851|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
2543|0.267|679.044|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4, $5)

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
