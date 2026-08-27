/**
 * Sync Job Repository Port
 *
 * Defines the contract for sync job persistence operations. Implemented by
 * infrastructure repositories to provide job storage capabilities.
 * This port abstracts the database implementation, allowing the application
 * layer to work with domain entities without depending on specific infrastructure.
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link SyncJobRepository} for the TypeORM implementation
 */
import type { SyncJob } from '../entities/sync-job.entity';
import type { ConnectionBacklogStats } from '../types/connection-sync-status.types';
import type {
  JobOutcome,
  JobOutcomeReason,
  JobType,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
  SyncJobGroupFilters,
  SyncJobGroupsResult,
  BulkRetryResult,
} from '../types/sync-job.types';

/**
 * Sync Job Repository Port
 *
 * Interface for sync job persistence operations. Implementations handle
 * the specifics of the underlying database technology (TypeORM, etc.)
 * and map between domain entities and ORM entities.
 */
export interface SyncJobRepositoryPort {
  /**
   * Create job if not exists by idempotency key
   *
   * Idempotent operation: if job with same idempotencyKey exists, returns existing job.
   * Otherwise, creates new job with status 'queued'.
   *
   * @param job - Sync job domain entity (without id, status, attempts, etc. - these are set by repository)
   * @param options.runAfter - Optional schedule timestamp. When provided, the
   *   row's `nextRunAt` is set to this date so the runner only picks the job
   *   up at that time. Defaults to `new Date()` (immediate). Used by the
   *   self-rescheduling offer-creation-status poller (#447) to space out
   *   iterations without going through Redis Streams.
   * @returns Created or existing sync job domain entity
   */
  createIfNotExistsByIdempotencyKey(
    job: Omit<
      SyncJob,
      | 'id'
      | 'status'
      | 'attempts'
      | 'nextRunAt'
      | 'lockedAt'
      | 'lockedBy'
      | 'lastError'
      | 'createdAt'
      | 'updatedAt'
    >,
    options?: { runAfter?: Date }
  ): Promise<SyncJob>;

  /**
   * Find and lock due jobs (transactional, atomic)
   *
   * Finds jobs with status 'queued' and nextRunAt <= now(), locks them atomically
   * using PostgreSQL FOR UPDATE SKIP LOCKED, and returns them. This prevents
   * double-processing across multiple workers.
   *
   * @param limit - Maximum number of jobs to lock
   * @param workerId - Worker instance ID that will lock the jobs
   * @returns Array of locked sync job domain entities
   */
  findAndLockDueJobs(limit: number, workerId: string): Promise<SyncJob[]>;

  /**
   * Find and lock due jobs restricted to one concurrency lane's job types
   * (ADR-050, #2278).
   *
   * Same transactional FOR UPDATE SKIP LOCKED shape and the same in-lane
   * ordering (`ORDER BY "nextRunAt" ASC`) as {@link findAndLockDueJobs}; the
   * restriction axes are additive. Lane membership is the CALLER's knowledge —
   * the authoritative jobType→lane mapping lives at handler registration in
   * the worker, so this method takes the lane's job types verbatim rather
   * than a lane name.
   *
   * `excludedScopes` lists scopes (today: connection ids — see
   * `resolveJobScope`) already at their per-scope cap; their rows stay
   * `queued` for a later tick instead of being locked and released back
   * (claim-side exclusion avoids churn). An empty/absent list adds no SQL arm.
   * Note the exclusion is pre-claim only: one claim can still return several
   * jobs of a single scope, and the runner trims that intra-batch surplus.
   *
   * @param input.jobTypes - The lane's job types (from the handler registry)
   * @param input.limit - Maximum number of jobs to lock (the lane's free slots)
   * @param input.workerId - Worker instance ID that will lock the jobs
   * @param input.excludedScopes - Scopes at their per-scope cap, skipped in the claim
   * @returns Array of locked sync job domain entities
   */
  findAndLockDueJobsForLane(input: {
    jobTypes: JobType[];
    limit: number;
    workerId: string;
    excludedScopes?: string[];
  }): Promise<SyncJob[]>;

  /**
   * Mark job as succeeded and record its business outcome.
   *
   * The outcome captures whether the underlying business operation
   * succeeded or terminated in a non-retryable rejection (e.g. marketplace
   * validation failed on `marketplace.offer.create`). It is written
   * atomically with the status flip — see issue #400 (Plan B for #391).
   *
   * `lastAttemptDurationMs` is written in the same UPDATE for the same
   * reason (#2611): the number must describe the very attempt whose outcome
   * is being recorded, so it cannot be a second write that could land
   * separately or not at all.
   *
   * @param id - Job ID
   * @param outcome - Business outcome of the run (`'ok' | 'business_failure'`)
   * @param outcomeReason - Optional stable code further classifying `outcome` (#1689)
   * @param lastAttemptDurationMs - Duration of the attempt just completed, in
   *   milliseconds (#2611). Omit when the caller did not measure an attempt -
   *   the column is then left untouched rather than set to zero.
   */
  markSucceeded(
    id: string,
    outcome: JobOutcome,
    outcomeReason?: JobOutcomeReason,
    lastAttemptDurationMs?: number
  ): Promise<void>;

  /**
   * Mark job as failed and schedule retry
   *
   * A retry wave overwrites `lastAttemptDurationMs` rather than accumulating
   * into it, so the column means the same thing on a first-attempt row and on
   * a five-attempt one (#2611). Total time across attempts is deliberately not
   * persisted: it would mix execution with hours of backoff.
   *
   * @param id - Job ID
   * @param error - Error message
   * @param nextRunAt - Next retry timestamp
   * @param lastAttemptDurationMs - Duration of the failed attempt, in milliseconds (#2611)
   */
  markFailed(
    id: string,
    error: string,
    nextRunAt: Date,
    lastAttemptDurationMs?: number
  ): Promise<void>;

  /**
   * Mark job as dead (max attempts reached)
   *
   * @param id - Job ID
   * @param error - Final error message
   * @param lastAttemptDurationMs - Duration of the attempt that died, in
   *   milliseconds (#2611). Omitted by callers that kill a job which never
   *   executed (e.g. an unroutable intake message), leaving the column NULL.
   */
  markDead(id: string, error: string, lastAttemptDurationMs?: number): Promise<void>;

  /**
   * Requeue a job WITHOUT counting it against `maxAttempts` (#1810 review
   * follow-up on #1957).
   *
   * A queued `acquire()` that times out waiting for a saturated per-connection
   * rate-limit slot (`RateLimitTimeoutError`) is not a business failure of the
   * job's own logic — it's congestion the job itself did nothing to cause.
   * Routing it through `markFailed` would burn a real retry attempt (and
   * eventually `markDead` the job) purely because a shared resource was busy,
   * which is exactly the kind of noisy-neighbor effect the rate limiter exists
   * to prevent, not cause. Requeues at `nextRunAt` with `attempts` unchanged.
   *
   * @param id - Job ID
   * @param error - Informational message (not counted as a failure reason for retry-budget purposes)
   * @param nextRunAt - Next pickup timestamp
   */
  requeueWithoutPenalty(id: string, error: string, nextRunAt: Date): Promise<void>;

  /**
   * Find jobs matching filters with offset pagination.
   * Results are ordered by createdAt DESC.
   */
  findMany(filters: SyncJobFilters, pagination: SyncJobPagination): Promise<PaginatedSyncJobs>;

  /**
   * Find a single job by ID. Returns null if not found.
   */
  findById(id: string): Promise<SyncJob | null>;

  /**
   * Find a single job by its unique idempotency key. Returns null if not found.
   *
   * The idempotency key is the durable cross-reference between an inbound
   * trigger and the persisted job it produced — the key an enqueuer computes
   * (e.g. `InboundRoutingPolicyService` uses `{platformType}:{connectionId}:{sourceEventId}`)
   * is the same one stored on the row. Callers that only hold the enqueue
   * coordinates (not the DB UUID) use this to resolve the actual `SyncJob` —
   * e.g. correlating a webhook delivery to the job it triggered (#1366).
   */
  findByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | null>;

  /**
   * Requeue stuck jobs (optional helper)
   *
   * Finds jobs stuck in 'running' status longer than lockTimeoutMinutes,
   * and requeues them (sets status to 'queued', clears lockedAt and lockedBy).
   *
   * @param lockTimeoutMinutes - Lock timeout in minutes
   * @returns Number of jobs requeued
   */
  requeueStuckJobs(lockTimeoutMinutes: number): Promise<number>;

  /**
   * Requeue a dead job for retry
   *
   * Resets a job in 'dead' status back to 'queued' with attempts=0 and
   * nextRunAt=now(), allowing the worker to pick it up again.
   * Throws InvalidSyncJobStateError if the job is not in 'dead' status.
   *
   * @param id - Job ID
   * @returns Updated sync job domain entity
   */
  requeueDeadJob(id: string): Promise<SyncJob>;

  /**
   * Requeue a DEAD job identified by its idempotency key, in a single guarded
   * statement (#1585 S3). A lone `UPDATE ... WHERE idempotencyKey = ? AND status
   * = 'dead'` so two overlapping callers cannot both observe `dead` and both
   * act - Postgres serialises the row write and exactly one sees `affected > 0`.
   * Returns `true` when a dead job was requeued, `false` when no matching dead
   * job exists (absent key, or a job that is queued / running / already requeued)
   * - never throws on a non-dead / missing row (unlike {@link requeueDeadJob},
   * which is id-addressed and asserts state).
   *
   * @param idempotencyKey - The job's idempotency key
   * @returns `true` if a dead job was requeued, else `false`
   */
  requeueDeadByIdempotencyKey(idempotencyKey: string): Promise<boolean>;

  /**
   * Find recent jobs for a connection
   *
   * Returns the most recent sync jobs for the given connection, ordered by
   * createdAt descending. Used for diagnostics and activity summary views.
   *
   * @param connectionId - Connection UUID
   * @param limit - Maximum number of jobs to return
   * @returns Array of sync job domain entities, newest first
   */
  findRecentByConnectionId(connectionId: string, limit: number): Promise<SyncJob[]>;

  /**
   * Aggregate jobs by (connectionId, jobType) for the given status filter.
   *
   * Collapses all matching jobs into one row per signature with count,
   * latest update timestamp, the most-recently-updated job's id as the
   * representative, and that job's lastError. Groups are sorted by count
   * DESC, then latestUpdatedAt DESC, and capped at `maxGroups`. `totalGroups`
   * and `totalJobs` are absolute counts so callers can render "top N of M".
   *
   * @param filters - Required status filter plus optional connectionId scope
   * @param maxGroups - Upper bound on the `groups` array (e.g. 100)
   * @returns Aggregated result with capped groups and total counts
   */
  findGroupedByStatus(
    filters: SyncJobGroupFilters,
    maxGroups: number
  ): Promise<SyncJobGroupsResult>;

  /**
   * Re-queue up to `maxBatchSize` dead jobs matching `(connectionId, jobType)`.
   *
   * Atomic conditional UPDATE per job (`WHERE id = ANY(:ids) AND status = 'dead'`)
   * so jobs that flipped out of `dead` between our SELECT and UPDATE are skipped
   * rather than double-enqueued. `skipped` reflects the difference between the
   * selected batch size and the actually-updated rowcount.
   *
   * @param connectionId - Connection UUID scoping the group
   * @param jobType - Job type scoping the group
   * @param maxBatchSize - Upper bound on jobs to re-queue in one call
   * @returns `requeuedJobIds` (updated), `count` (updated.length), `skipped`
   */
  requeueDeadJobsInGroup(
    connectionId: string,
    jobType: string,
    maxBatchSize: number
  ): Promise<BulkRetryResult>;

  /**
   * Find the most recently *completed* succeeded job for a connection and
   * job type, ordered by `updatedAt` DESC (the moment it flipped to
   * succeeded) rather than `createdAt` (enqueue time), with `id` DESC as a
   * deterministic tiebreaker for two rows sharing a timestamp. This is the
   * precise "last successful ingestion" signal — `findMany` orders by
   * `createdAt` only, which is enqueue time, not completion time (#1982).
   *
   * Also excludes `outcome: 'business_failure'` (ADR-007): `status:
   * 'succeeded'` is orchestration, `outcome` is the business result, and a
   * job can be succeeded yet business-failed. Requires the DB index
   * `(connectionId, jobType, status, updatedAt)` (see the `#1982`-tagged
   * migration) — this method is called on the render-blocking analytics
   * data-trust read path, once per connection.
   *
   * @param connectionId - Connection UUID
   * @param jobType - Job type to match (e.g. 'marketplace.orders.poll')
   * @returns The most recently succeeded matching job, or null if none exists
   */
  findLastSucceededByConnectionAndJobType(
    connectionId: string,
    jobType: JobType
  ): Promise<SyncJob | null>;

  /**
   * Refresh the lock timestamp of a job the caller still holds (#1810).
   *
   * Lets a long-running job (e.g. one queued behind a saturated per-connection
   * rate limiter) prove liveness to {@link requeueStuckJobs} without finishing.
   * Guarded on `lockedBy`: a heartbeat from a worker that no longer owns the
   * job (already requeued and re-picked by another worker) is a no-op rather
   * than clobbering the new owner's lock.
   *
   * @param id - Job ID
   * @param workerId - Worker instance ID that must currently hold the lock
   */
  heartbeat(id: string, workerId: string): Promise<void>;

  /**
   * Aggregate one connection's queue facts in a single round trip (#2615):
   * current queued/running/dead counts, arrivals and terminal completions
   * inside `windowStart..now`, the mean attempt duration over that window,
   * and the creation time of the oldest still-queued job.
   *
   * The mean EXCLUDES rows whose `lastAttemptDurationMs` is null and reports
   * the non-null sample size alongside it (#2611) - the column is null on
   * every row predating its migration, so counting those as zero would
   * understate every real duration. The value describes one attempt, so this
   * method deliberately offers no sum: total time spent syncing cannot be
   * built from it.
   *
   * Aggregate-only, so the result size is independent of the number of jobs.
   *
   * @param connectionId - Connection UUID
   * @param windowStart - Start of the observation window
   */
  getConnectionBacklogStats(
    connectionId: string,
    windowStart: Date
  ): Promise<ConnectionBacklogStats>;
}
