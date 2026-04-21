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
import { SyncJob } from '../entities/sync-job.entity';
import {
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
   * @returns Created or existing sync job domain entity
   */
  createIfNotExistsByIdempotencyKey(job: Omit<SyncJob, 'id' | 'status' | 'attempts' | 'nextRunAt' | 'lockedAt' | 'lockedBy' | 'lastError' | 'createdAt' | 'updatedAt'>): Promise<SyncJob>;

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
   * Mark job as succeeded
   *
   * @param id - Job ID
   */
  markSucceeded(id: string): Promise<void>;

  /**
   * Mark job as failed and schedule retry
   *
   * @param id - Job ID
   * @param error - Error message
   * @param nextRunAt - Next retry timestamp
   */
  markFailed(id: string, error: string, nextRunAt: Date): Promise<void>;

  /**
   * Mark job as dead (max attempts reached)
   *
   * @param id - Job ID
   * @param error - Final error message
   */
  markDead(id: string, error: string): Promise<void>;

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
    maxGroups: number,
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
    maxBatchSize: number,
  ): Promise<BulkRetryResult>;
}

