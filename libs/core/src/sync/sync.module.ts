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
import { ConnectionCursorOrmEntity } from './infrastructure/persistence/entities/connection-cursor.orm-entity';
import { ConnectionCursorRepository } from './infrastructure/persistence/repositories/connection-cursor.repository';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from './sync.tokens';

// Re-export tokens for convenience
export {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from './sync.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncJobOrmEntity, ConnectionCursorOrmEntity]),
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
    // Also provide as string tokens for convenience
    {
      provide: 'JobEnqueuePort',
      useExisting: JOB_ENQUEUE_TOKEN,
    },
    {
      provide: 'SyncJobRepositoryPort',
      useExisting: SYNC_JOB_REPOSITORY_TOKEN,
    },
    {
      provide: 'ConnectionCursorRepositoryPort',
      useExisting: CONNECTION_CURSOR_REPOSITORY_TOKEN,
    },
  ],
  exports: [
    JOB_ENQUEUE_TOKEN,
    SYNC_JOB_REPOSITORY_TOKEN,
    CONNECTION_CURSOR_REPOSITORY_TOKEN,
    RedisStreamsJobEnqueueService,
    SyncJobRepository,
    ConnectionCursorRepository,
    'JobEnqueuePort',
    'SyncJobRepositoryPort',
    'ConnectionCursorRepositoryPort',
  ],
})
export class SyncModule {}



