/**
 * Sync Job Domain Entity
 *
 * Represents a persisted sync job in the OpenLinker system. Jobs are persisted
 * to the database for durable retries, observability, and idempotency.
 *
 * @module libs/core/src/sync/domain/entities
 */
import type { JobType, JobStatus, JobOutcome, JobOutcomeReason } from '../types/sync-job.types';

export class SyncJob {
  constructor(
    public readonly id: string,
    public readonly jobType: JobType,
    public readonly connectionId: string,
    public readonly payload: Record<string, unknown>,
    public readonly status: JobStatus,
    public readonly idempotencyKey: string,
    public readonly attempts: number,
    public readonly maxAttempts: number,
    public readonly nextRunAt: Date,
    public readonly lockedAt: Date | null,
    public readonly lockedBy: string | null,
    public readonly lastError: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly outcome?: JobOutcome | null,
    public readonly outcomeReason?: JobOutcomeReason | null,
    /**
     * Duration in milliseconds of the most recently completed execution
     * attempt (#2611). `null`/undefined when no attempt has completed yet, or
     * for a row predating the column - never read as zero.
     */
    public readonly lastAttemptDurationMs?: number | null,
    /**
     * Total milliseconds of penalty-free deferral granted so far (#2613/#2617).
     * The bound that stops a deferred job living for ever. `null`/undefined
     * when the job has never been deferred.
     */
    public readonly deferredTotalMs?: number | null
  ) {}
}
