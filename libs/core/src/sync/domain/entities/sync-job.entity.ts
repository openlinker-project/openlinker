/**
 * Sync Job Domain Entity
 *
 * Represents a persisted sync job in the OpenLinker system. Jobs are persisted
 * to the database for durable retries, observability, and idempotency.
 *
 * @module libs/core/src/sync/domain/entities
 */
import { JobType, JobStatus, JobOutcome } from '../types/sync-job.types';

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
  ) {}
}

