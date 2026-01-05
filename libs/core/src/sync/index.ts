/**
 * Sync Module Exports
 *
 * Central export point for the sync module. Exports ports, types, exceptions,
 * and tokens for use in other modules.
 *
 * @module libs/core/src/sync
 */

// Ports
export { JobEnqueuePort } from './domain/ports/job-enqueue.port';
export { SyncJobRepositoryPort } from './domain/ports/sync-job-repository.port';
export { SyncJobHandler } from './domain/ports/sync-job-handler.port';

// Domain Entities
export { SyncJob as SyncJobEntity } from './domain/entities/sync-job.entity';

// Types
export type { SyncJob, SyncJobRequest, JobType, JobStatus } from './domain/types/sync-job.types';
export { JobTypeValues, JobStatusValues } from './domain/types/sync-job.types';

// Exceptions
export { SyncJobExecutionError } from './domain/exceptions/sync-job-execution.error';

// Infrastructure exports (for testing/mocking)
export { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';

// Module and tokens
export { SyncModule } from './sync.module';
export { JOB_ENQUEUE_TOKEN, SYNC_JOB_REPOSITORY_TOKEN } from './sync.tokens';

// ORM Entities (exported for testing and TypeORM CLI usage)
export { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';



