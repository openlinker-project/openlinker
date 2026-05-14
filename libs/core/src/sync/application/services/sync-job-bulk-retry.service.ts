/**
 * Sync Job Bulk Retry Service
 *
 * Re-queues every dead job in a `(connectionId, jobType)` group and publishes
 * one `sync.job.bulk-retry-requested` event per successful batch. Event is
 * skipped when no jobs moved (nothing to announce).
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncJobBulkRetryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import { EVENT_PUBLISHER_TOKEN, EventPublisherPort } from '@openlinker/core/events';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { BulkRetryResult, JobType } from '../../domain/types/sync-job.types';
import {
  BULK_RETRY_MAX_BATCH_SIZE,
  SYNC_JOBS_EVENT_STREAM,
} from '../../domain/types/sync-job.types';
import type { ISyncJobBulkRetryService } from './sync-job-bulk-retry.service.interface';

@Injectable()
export class SyncJobBulkRetryService implements ISyncJobBulkRetryService {
  private readonly logger = new Logger(SyncJobBulkRetryService.name);
  private readonly SCHEMA_VERSION = '1';

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort
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

    const now = new Date().toISOString();
    await this.eventPublisher.publish(SYNC_JOBS_EVENT_STREAM, {
      eventId: randomUUID(),
      eventType: 'sync.job.bulk-retry-requested',
      payloadJson: JSON.stringify({
        connectionId,
        jobType,
        jobIds: result.requeuedJobIds,
        count: result.count,
        skipped: result.skipped,
      }),
      metadataJson: JSON.stringify({ schemaVersion: this.SCHEMA_VERSION }),
      occurredAt: now,
      publishedAt: now,
    });

    this.logger.log(
      `Bulk retry re-queued ${result.count} job(s) (connection: ${connectionId}, type: ${jobType}, skipped: ${result.skipped})`
    );

    return result;
  }
}
