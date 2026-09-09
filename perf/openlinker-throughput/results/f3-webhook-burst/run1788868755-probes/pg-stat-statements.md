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
