/**
 * Sync Module
 *
 * NestJS module for sync job functionality. Configures job enqueue port,
 * job repository, and dependency injection. Exports ports for use in other
 * modules (API, Worker).
 *
 * @module libs/core/src/sync
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';
import { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';
import { SyncJobRepository } from './infrastructure/persistence/repositories/sync-job.repository';
import { JOB_ENQUEUE_TOKEN, SYNC_JOB_REPOSITORY_TOKEN } from './sync.tokens';

// Re-export tokens for convenience
export { JOB_ENQUEUE_TOKEN, SYNC_JOB_REPOSITORY_TOKEN } from './sync.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([SyncJobOrmEntity])],
  providers: [
    // Job enqueue service
    RedisStreamsJobEnqueueService,
    {
      provide: JOB_ENQUEUE_TOKEN,
      useExisting: RedisStreamsJobEnqueueService,
    },
    // Job repository
    SyncJobRepository,
    {
      provide: SYNC_JOB_REPOSITORY_TOKEN,
      useExisting: SyncJobRepository,
    },
    // Also provide as string tokens for convenience
    {
      provide: 'JobEnqueuePort',
      useExisting: JOB_ENQUEUE_TOKEN,
    },
    {
      provide: 'SyncJobRepositoryPort',
      useExisting: SYNC_JOB_REPOSITORY_TOKEN,
    },
  ],
  exports: [
    JOB_ENQUEUE_TOKEN,
    SYNC_JOB_REPOSITORY_TOKEN,
    RedisStreamsJobEnqueueService,
    SyncJobRepository,
    'JobEnqueuePort',
    'SyncJobRepositoryPort',
  ],
})
export class SyncModule {}



