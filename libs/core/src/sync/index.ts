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
export { ConnectionCursorRepositoryPort } from './domain/ports/connection-cursor-repository.port';
export { SyncJobQueuePort, EnqueueJobRequest, EnqueueJobOptions } from './application/ports/sync-job-queue.port';
export { SyncLockPort, SyncLockToken } from './application/ports/sync-lock.port';

// Domain Entities
export { SyncJob as SyncJobEntity } from './domain/entities/sync-job.entity';

// Connection Cursor Types
export type {
  ConnectionCursor,
  ConnectionCursorFilters,
  ConnectionCursorPagination,
  PaginatedConnectionCursors,
} from './domain/types/connection-cursor.types';

// Types
export type {
  SyncJob,
  SyncJobRequest,
  EnqueueJobResult,
  JobType,
  JobStatus,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
} from './domain/types/sync-job.types';
export { JobTypeValues, JobStatusValues } from './domain/types/sync-job.types';
export {
  MarketplaceOrdersPollPayloadV1,
  MarketplaceOrderSyncPayloadV1,
  MarketplaceOfferQuantityUpdatePayloadV1,
  MarketplaceOfferFieldUpdatePayloadV1,
  MarketplaceOffersSyncPayloadV1,
} from './domain/types/marketplace-job-payloads.types';
export {
  MasterProductSyncByExternalIdPayloadV1,
  MasterInventorySyncByExternalIdPayloadV1,
  MasterInventorySyncAllPayloadV1,
} from './domain/types/master-job-payloads.types';

// Exceptions
export { SyncJobExecutionError } from './domain/exceptions/sync-job-execution.error';
export { InvalidSyncJobStateError } from './domain/exceptions/invalid-sync-job-state.error';

// Infrastructure exports (for testing/mocking)
export { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';

// Module and tokens
export { SyncModule } from './sync.module';
export {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
} from './sync.tokens';

// ORM Entities (exported for testing and TypeORM CLI usage)
export { SyncJobOrmEntity } from './infrastructure/persistence/entities/sync-job.orm-entity';
export { ConnectionCursorOrmEntity } from './infrastructure/persistence/entities/connection-cursor.orm-entity';



