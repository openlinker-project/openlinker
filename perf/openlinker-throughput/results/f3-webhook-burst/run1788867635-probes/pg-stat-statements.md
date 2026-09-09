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
