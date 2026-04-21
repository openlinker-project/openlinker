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
import { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';
import { SyncJobRepository } from './infrastructure/persistence/repositories/sync-job.repository';
import { ConnectionCursorOrmEntity } from './infrastructure/persistence/entities/connection-cursor.orm-entity';
import { ConnectionCursorRepository } from './infrastructure/persistence/repositories/connection-cursor.repository';
import { SyncJobQueueService } from './application/services/sync-job-queue.service';
import { RedisSyncLockService } from './application/services/redis-sync-lock.service';
import { SyncJobRetryService } from './application/services/sync-job-retry.service';
import { SyncJobBulkRetryService } from './application/services/sync-job-bulk-retry.service';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SYNC_JOB_RETRY_SERVICE_TOKEN,
  SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
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
} from './sync.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncJobOrmEntity, ConnectionCursorOrmEntity]),
    EventsModule,
  ],
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
  ],
})
export class SyncModule {}



