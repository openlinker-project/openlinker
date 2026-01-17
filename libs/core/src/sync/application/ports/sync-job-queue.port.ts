/**
 * Sync Job Queue Port (Application Layer)
 *
 * Application-level abstraction for enqueueing sync jobs with deduplication.
 *
 * This is intentionally NOT a domain port: job scheduling is orchestration.
 *
 * @module libs/core/src/sync/application/ports
 */

import { JobType } from '../../domain/types/sync-job.types';

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

export interface SyncJobQueuePort {
  enqueue(request: EnqueueJobRequest): Promise<string>;
  /**
   * Enqueue multiple jobs.
   *
   * NOTE: Implementations may enqueue sequentially depending on the underlying queue.
   * Callers must not rely on this being an atomic/batched operation.
   */
  enqueueBulk(requests: EnqueueJobRequest[]): Promise<string[]>;
}

