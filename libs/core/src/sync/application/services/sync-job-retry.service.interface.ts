/**
 * Sync Job Retry Service Interface
 *
 * Defines the contract for retrying dead sync jobs. Allows operators to
 * manually requeue jobs that have exhausted automatic retries.
 *
 * @module libs/core/src/sync/application/services
 */
import type { SyncJob } from '../../domain/entities/sync-job.entity';

export interface ISyncJobRetryService {
  /**
   * Retry a dead sync job by requeuing it.
   *
   * @param id - Job ID to retry
   * @returns Updated sync job with status 'queued'
   * @throws InvalidSyncJobStateError if job is not in 'dead' status
   * @throws Error if job is not found
   */
  retryJob(id: string): Promise<SyncJob>;
}
