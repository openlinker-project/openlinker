/**
 * Sync Job Queue Port (Application Layer)
 *
 * Application-level abstraction for enqueueing sync jobs with deduplication.
 *
 * This is intentionally NOT a domain port: job scheduling is orchestration.
 *
 * @module libs/core/src/sync/application/ports
 */

import type { JobType } from '../../domain/types/sync-job.types';

export interface EnqueueJobOptions {
  /**
   * Deterministic dedupe key (idempotency key).
   */
  dedupeKey: string;

  /**
   * Optional delay in milliseconds.
   *
   * NOTE: If the underlying queue implementation does not support delayed enqueue,
   * it should throw rather than silently ignoring this.
   */
  delayMs?: number;
}

export interface EnqueueJobRequest {
  type: JobType;
  connectionId: string;
  payload: Record<string, unknown>;
  options: EnqueueJobOptions;
}

/** What one enqueue answered: the job id and whether the dedupe key already existed. */
export interface EnqueueJobOutcome {
  jobId: string;
  /** True when the idempotency key was already taken, so nothing new was queued. */
  isExisting: boolean;
}

export interface SyncJobQueuePort {
  enqueue(request: EnqueueJobRequest): Promise<string>;
  /**
   * Enqueue multiple jobs.
   *
   * NOTE: Implementations may enqueue sequentially depending on the underlying queue.
   * Callers must not rely on this being an atomic/batched operation.
   */
  enqueueBulk(requests: EnqueueJobRequest[]): Promise<string[]>;
  /**
   * Enqueue one job and report whether its dedupe key already existed. For a
   * caller that must not read a swallowed enqueue as success (the first page of
   * an order import chain, #4228).
   */
  enqueueDetailed(request: EnqueueJobRequest): Promise<EnqueueJobOutcome>;
}
