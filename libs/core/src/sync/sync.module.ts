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
import { EventsModule } from '@openlinker/core/events';
import { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';
import { RetryClassifierRegistryService } from './infrastructure/adapters/retry-classifier-registry.service';
import { SchedulerTaskRegistryService } from './infrastructure/adapters/scheduler-task-registry.service';
import { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';
import { SyncJobRepository } from './infrastructure/persistence/repositories/sync-job.repository';
import { ConnectionCursorOrmEntity } from './infrastructure/persistence/entities/connection-cursor.orm-entity';
import { ConnectionCursorRepository } from './infrastructure/persistence/repositories/connection-cursor.repository';
import { SyncJobQueueService } from './application/services/sync-job-queue.service';
import { RedisSyncLockService } from './application/services/redis-sync-lock.service';
import { SyncJobRetryService } from './application/services/sync-job-retry.service';
import { SyncJobBulkRetryService } from './application/services/sync-job-bulk-retry.service';
import { SyncJobsService } from './application/services/sync-jobs.service';
import { SyncCursorsService } from './application/services/sync-cursors.service';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SYNC_JOB_RETRY_SERVICE_TOKEN,
  SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SYNC_JOBS_SERVICE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
} from './sync.tokens';

// Re-export tokens for convenience
export {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SYNC_JOB_RETRY_SERVICE_TOKEN,
  SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SYNC_JOBS_SERVICE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
} from './sync.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([SyncJobOrmEntity, ConnectionCursorOrmEntity]), EventsModule],
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
    // Connection cursor repository
    ConnectionCursorRepository,
    {
      provide: CONNECTION_CURSOR_REPOSITORY_TOKEN,
      useExisting: ConnectionCursorRepository,
    },

    // Sync job queue abstraction (application-level)
    SyncJobQueueService,
    {
      provide: SYNC_JOB_QUEUE_TOKEN,
      useExisting: SyncJobQueueService,
    },

    // Retry service (application-level)
    SyncJobRetryService,
    {
      provide: SYNC_JOB_RETRY_SERVICE_TOKEN,
      useExisting: SyncJobRetryService,
    },

    // Bulk retry service (application-level)
    SyncJobBulkRetryService,
    {
      provide: SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
      useExisting: SyncJobBulkRetryService,
    },

    // Distributed lock (application-level)
    RedisSyncLockService,
    {
      provide: SYNC_LOCK_TOKEN,
      useExisting: RedisSyncLockService,
    },

    // Retry classifier registry — integration modules self-register their
    // platform-specific classifiers in `onModuleInit`; the runner queries
    // the registry instead of importing exception classes by name (#581).
    RetryClassifierRegistryService,
    {
      provide: RETRY_CLASSIFIER_REGISTRY_TOKEN,
      useExisting: RetryClassifierRegistryService,
    },

    // Scheduler task registry — integration modules contribute their cron
    // tasks (Allegro orders-poll, offers-sync, …) at bootstrap; the API-side
    // `SchedulerService` drains the registry at `onApplicationBootstrap`
    // instead of carrying platform-specific knowledge in core (#584).
    SchedulerTaskRegistryService,
    {
      provide: SCHEDULER_TASK_REGISTRY_TOKEN,
      useExisting: SchedulerTaskRegistryService,
    },

    // Cross-context service seams (#718 slice 2): jobs scheduling +
    // cursors. Wrap the repository ports so consumers in other contexts
    // don't reach across the boundary to a `*RepositoryPort`.
    SyncJobsService,
    {
      provide: SYNC_JOBS_SERVICE_TOKEN,
      useExisting: SyncJobsService,
    },
    SyncCursorsService,
    {
      provide: SYNC_CURSORS_SERVICE_TOKEN,
      useExisting: SyncCursorsService,
    },
  ],
  exports: [
    JOB_ENQUEUE_TOKEN,
    SYNC_JOB_REPOSITORY_TOKEN,
    CONNECTION_CURSOR_REPOSITORY_TOKEN,
    RedisStreamsJobEnqueueService,
    SyncJobRepository,
    ConnectionCursorRepository,
    SYNC_JOB_QUEUE_TOKEN,
    SyncJobQueueService,
    SYNC_LOCK_TOKEN,
    RedisSyncLockService,
    SYNC_JOB_RETRY_SERVICE_TOKEN,
    SyncJobRetryService,
    SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
    SyncJobBulkRetryService,
    RETRY_CLASSIFIER_REGISTRY_TOKEN,
    RetryClassifierRegistryService,
    SCHEDULER_TASK_REGISTRY_TOKEN,
    SchedulerTaskRegistryService,
    SYNC_JOBS_SERVICE_TOKEN,
    SYNC_CURSORS_SERVICE_TOKEN,
  ],
})
export class SyncModule {}
