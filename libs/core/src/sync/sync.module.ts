/**
 * Sync Module
 *
 * NestJS module for sync job functionality. Configures job enqueue port
 * and dependency injection. Exports the JobEnqueuePort for use in other
 * modules (API, Worker).
 *
 * @module libs/core/src/sync
 */
import { Module } from '@nestjs/common';
import { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';
import { JOB_ENQUEUE_TOKEN } from './sync.tokens';

// Re-export tokens for convenience
export { JOB_ENQUEUE_TOKEN } from './sync.tokens';

@Module({
  providers: [
    RedisStreamsJobEnqueueService,
    {
      provide: JOB_ENQUEUE_TOKEN,
      useExisting: RedisStreamsJobEnqueueService,
    },
  ],
  exports: [
    JOB_ENQUEUE_TOKEN,
    RedisStreamsJobEnqueueService,
  ],
})
export class SyncModule {}

