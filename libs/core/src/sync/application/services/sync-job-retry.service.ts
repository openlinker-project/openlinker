/**
 * Sync Job Retry Service
 *
 * Allows operators to manually retry dead sync jobs by requeuing them.
 * Delegates to the repository port for the actual state transition.
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncJobRetryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { ISyncJobRetryService } from './sync-job-retry.service.interface';

@Injectable()
export class SyncJobRetryService implements ISyncJobRetryService {
  private readonly logger = new Logger(SyncJobRetryService.name);

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort
  ) {}

  async retryJob(id: string): Promise<SyncJob> {
    this.logger.log(`Retrying dead job: ${id}`);

    const job = await this.syncJobRepository.requeueDeadJob(id);

    this.logger.log(
      `Job requeued for retry: ${job.id} (type: ${job.jobType}, connection: ${job.connectionId})`
    );

    return job;
  }
}
