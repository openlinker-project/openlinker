pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
1528268|0.052|79707.845|INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "rece
1527609|0.060|91185.220|INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttemp
870401|0.016|14345.533|UPDATE webhook_deliveries
          SET "status" = $6,
              "downstreamJobId" = $1,
              "downstreamJobType" = COALESCE($2
469945|0.014|6654.026|SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1
212268|0.830|176179.011|SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2 AND "jobType" = ANY($3)
        ORDER BY "nextRunAt" ASC
        LIM
71534|0.027|1953.465|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
58439|0.066|3882.285|INSERT INTO "sync_jobs"("id", "jobType", "connectionId", "payloadJson", "status", "outcome", "outcomeReason", "idempotencyKey", "attempts", 
26683|0.095|2535.890|UPDATE "sync_jobs" SET "status" = $1, "outcome" = $2, "outcomeReason" = $3, "lockedAt" = $4, "lockedBy" = $5, "lastError" = $6, "lastAttempt
25369|0.490|12427.072|SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2 AND "jobType" = ANY($3) AND "connectionId" != ALL($4)
        ORDER 
17972|0.034|616.885|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
17972|0.081|1454.165|UPDATE "sync_jobs" SET "status" = $1, "attempts" = $2, "nextRunAt" = $3, "lockedAt" = $4, "lockedBy" = $5, "lastError" = $6, "lastAttemptDur
13014|0.088|1140.405|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4)
11641|0.087|1017.814|UPDATE "sync_jobs" SET "status" = $1, "nextRunAt" = $2, "lockedAt" = $3, "lockedBy" = $4, "lastError" = $5, "updatedAt" = CURRENT_TIMESTAMP 
11590|0.036|412.116|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
11590|0.138|1597.227|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4, $5)

```
