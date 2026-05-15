/**
 * Sync Jobs Service Types
 *
 * Input shapes for the cross-context sync-jobs service surface (#718).
 * Kept in a separate file from the interface per Engineering Standards
 * § "Type Definitions in Separate Files".
 *
 * @module libs/core/src/sync/application/services
 */
import type { JobType } from '../../domain/types/sync-job.types';

export interface ScheduleJobInput {
  jobType: JobType;
  connectionId: string;
  payload: Record<string, unknown>;
  /**
   * Deterministic idempotency key. Two scheduling attempts with the
   * same key produce one row; later attempts return the existing row.
   */
  idempotencyKey: string;
  /** Max attempts the runner will give this job. */
  maxAttempts: number;
  /** Earliest time the runner is allowed to pick up the job. */
  runAfter: Date;
}
