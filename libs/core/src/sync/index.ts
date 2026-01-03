/**
 * Sync Module Exports
 *
 * Central export point for the sync module. Exports ports, types, and tokens
 * for use in other modules.
 *
 * @module libs/core/src/sync
 */

// Domain exports
export { JobEnqueuePort } from './domain/ports/job-enqueue.port';
export type { SyncJob, JobType } from './domain/types/sync-job.types';
export { JobTypeValues } from './domain/types/sync-job.types';

// Infrastructure exports (for testing/mocking)
export { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';

// Module and tokens
export { SyncModule } from './sync.module';
export { JOB_ENQUEUE_TOKEN } from './sync.tokens';



