/**
 * Sync Job Bulk Retry Service Interface
 *
 * Contract for re-queuing all dead sync jobs matching a
 * (connectionId, jobType) group selector. Paired with
 * `SyncJobRepositoryPort.findGroupedByStatus` to let operators clear
 * an entire failure signature in one action instead of N per-job clicks.
 *
 * @module libs/core/src/sync/application/services
 */
import { BulkRetryResult, JobType } from '../../domain/types/sync-job.types';

export interface ISyncJobBulkRetryService {
  /**
   * Re-queue every dead job matching `(connectionId, jobType)`, capped at
   * `BULK_RETRY_MAX_BATCH_SIZE`. Jobs that flipped out of `dead` between
   * the selection and update are skipped, not re-enqueued.
   *
   * Emits `sync.job.bulk-retry-requested` on the `events.sync.jobs` stream
   * when at least one job is re-queued; silent on zero-count (nothing moved).
   *
   * @param connectionId - Connection UUID scoping the group
   * @param jobType - Job type scoping the group
   * @returns `requeuedJobIds`, `count`, and `skipped`
   */
  retryGroup(connectionId: string, jobType: JobType): Promise<BulkRetryResult>;
}
