/**
 * Sync Jobs Service Interface
 *
 * Cross-context application surface for scheduling sync jobs. The
 * single method (`schedule`) bypasses the Redis-stream queue path
 * on purpose — the stream backend does not support delayed delivery —
 * and writes the job row directly through `SyncJobRepositoryPort`.
 * The worker's polling loop (`nextRunAt <= now()`) picks the row up
 * at the requested time.
 *
 * @module libs/core/src/sync/application/services
 * @see {@link SyncJobsService} for the implementation
 */
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { ScheduleJobInput } from './sync-jobs.types';

export interface ISyncJobsService {
  /**
   * Schedule a sync job with a required `runAfter`, idempotently.
   *
   * This path inserts the job directly via the sync-job repository
   * rather than the Redis-stream queue, because the stream-based
   * enqueue (`SyncJobQueuePort.enqueue`) does not deliver messages
   * on a future timestamp. The worker's polling loop picks the job
   * up when `nextRunAt <= now()`.
   *
   * Returns the persisted job — the freshly-created row, or the
   * pre-existing row when the idempotency key has already been seen.
   */
  schedule(input: ScheduleJobInput): Promise<SyncJob>;

  /**
   * Re-drive a job that has exhausted its retries by requeuing it (#1585 I3).
   * Looks the job up by its `idempotencyKey` and, ONLY when it is currently in
   * `dead` status, resets it to `queued` (attempts=0, nextRunAt=now) so the
   * worker re-runs it. A no-op returning `false` when no job holds the key, or
   * the job is not `dead` (still queued/running — it will re-drive itself). This
   * is the safe re-drive seam for a never-transmitted `pending` invoice whose
   * original `invoicing.issue` job died: re-running the SAME idempotency-keyed
   * job resumes issuance against the existing record (no double-issue).
   */
  requeueDeadByIdempotencyKey(idempotencyKey: string): Promise<boolean>;
}
