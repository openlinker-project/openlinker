pg_stat_statements is preloaded and enabled - top statements touching `webhook_deliveries` or `sync_jobs`, by call count, over the whole time the extension has been collecting on this stand (not reset for this run, so the counts below include activity from other scenarios/arms; corroboration is directional, not an isolated measurement):

```
226863|0.223|50622.702|SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2 AND "jobType" = ANY($3)
        ORDER BY "nextRunAt" ASC
        LIM
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
2543|0.267|679.044|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4, $5)
2543|0.081|204.851|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
2359|0.195|459.533|SELECT "idempotencyKey" FROM sync_jobs
          WHERE "jobType"=$1
            AND "connectionId"=$2
            AND "idempotencyKey" ~ $3

2078|0.271|562.233|SELECT COUNT(*) FROM sync_jobs WHERE "connectionId" IN ($1) AND status=$2
1848|0.098|180.700|SELECT "SyncJobOrmEntity"."id" AS "SyncJobOrmEntity_id", "SyncJobOrmEntity"."jobType" AS "SyncJobOrmEntity_jobType", "SyncJobOrmEntity"."con
1848|0.336|621.396|UPDATE "sync_jobs" SET "status" = $1, "lockedAt" = $2, "lockedBy" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" IN ($4, $5, $6)

```
