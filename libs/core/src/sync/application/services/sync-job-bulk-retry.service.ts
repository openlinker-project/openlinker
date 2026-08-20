/**
 * Sync Job Bulk Retry Service
 *
 * Re-queues every dead job in a `(connectionId, jobType)` group.
 *
 * This used to also publish one `sync.job.bulk-retry-requested` event per batch
 * to `events.sync.jobs`. That stream had a publisher and, in its entire life, no
 * consumer — nothing ever called `xReadGroup` on it — so it was write-only and,
 * being unbounded, grew forever. The retry it announced has already completed
 * synchronously by the time the event is sent, so the event triggered nothing
 * and reported nothing that `sync_jobs` does not already hold. Removed rather
 * than consumed (#2163), consistent with ADR-049 decision 2.
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncJobBulkRetryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { BulkRetryResult, JobType } from '../../domain/types/sync-job.types';
import { BULK_RETRY_MAX_BATCH_SIZE } from '../../domain/types/sync-job.types';
import type { ISyncJobBulkRetryService } from './sync-job-bulk-retry.service.interface';

@Injectable()
export class SyncJobBulkRetryService implements ISyncJobBulkRetryService {
  private readonly logger = new Logger(SyncJobBulkRetryService.name);

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort
  ) {}

  async retryGroup(connectionId: string, jobType: JobType): Promise<BulkRetryResult> {
    this.logger.log(
      `Bulk retry requested for group (connection: ${connectionId}, type: ${jobType})`
    );

    const result = await this.syncJobRepository.requeueDeadJobsInGroup(
      connectionId,
      jobType,
      BULK_RETRY_MAX_BATCH_SIZE
    );

    if (result.count === 0) {
      this.logger.log(
        `Bulk retry produced no re-queue (connection: ${connectionId}, type: ${jobType}, skipped: ${result.skipped})`
      );
      return result;
    }

    this.logger.log(
      `Bulk retry re-queued ${result.count} job(s) (connection: ${connectionId}, type: ${jobType}, skipped: ${result.skipped})`
    );

    return result;
  }
}
