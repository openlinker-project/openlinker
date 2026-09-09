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
