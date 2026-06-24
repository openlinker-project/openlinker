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
export { RetryClassifierPort } from './domain/ports/retry-classifier.port';
export { AuthFailureClassifierPort } from './domain/ports/auth-failure-classifier.port';
export {
  SyncJobQueuePort,
  EnqueueJobRequest,
  EnqueueJobOptions,
} from './application/ports/sync-job-queue.port';
export { SyncLockPort, SyncLockToken } from './application/ports/sync-lock.port';

// Domain Entities
// NOTE: the entity CLASS is aliased to `SyncJobEntity` because the `SyncJob`
// name is already taken by the persisted-shape TYPE below (`sync-job.types`).
// Consumers wanting the class typically write
// `import { SyncJobEntity as SyncJob } from '@openlinker/core/sync'`
// to keep their local references short. Tracking a follow-up to rename the
// type (`SyncJobRecord` / `SyncJobData`) and drop this alias entirely.
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
  SyncJobHandlerResult,
  EnqueueJobResult,
  JobType,
  JobStatus,
  JobOutcome,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
  SyncJobGroup,
  SyncJobGroupsResult,
  SyncJobGroupFilters,
  BulkRetryResult,
} from './domain/types/sync-job.types';
export {
  JobTypeValues,
  JobStatusValues,
  JobOutcomeValues,
  BULK_RETRY_MAX_BATCH_SIZE,
  SYNC_JOBS_EVENT_STREAM,
} from './domain/types/sync-job.types';
export {
  MarketplaceOrdersPollPayloadV1,
  MarketplaceOrderSyncPayloadV1,
  MarketplaceOfferQuantityUpdatePayloadV1,
  MarketplaceOfferFieldUpdatePayloadV1,
  MarketplaceOffersSyncPayloadV1,
  MarketplaceOfferCreatePayloadV1,
  MarketplaceOfferCreatePayloadV2,
  MarketplaceOfferPollCreationStatusPayloadV1,
  MarketplaceOfferStatusSyncPayloadV1,
  MarketplaceOfferStockRestorePayloadV1,
  MarketplaceShipmentStatusSyncPayloadV1,
  MarketplaceShipmentSyncByExternalIdPayloadV1,
  MarketplaceFulfillmentStatusSyncPayloadV1,
  OfferDescriptionTone,
} from './domain/types/marketplace-job-payloads.types';
export { OfferDescriptionToneValues } from './domain/types/marketplace-job-payloads.types';
export {
  MasterProductSyncByExternalIdPayloadV1,
  MasterInventorySyncByExternalIdPayloadV1,
  MasterInventorySyncAllPayloadV1,
  MasterProductSyncAllPayloadV1,
} from './domain/types/master-job-payloads.types';
export {
  ShopProductPublishPayloadV1,
  ShopProductPublishPayloadV2,
  ShopProductPublishPayload,
} from './domain/types/shop-job-payloads.types';

// Exceptions
export { SyncJobExecutionError } from './domain/exceptions/sync-job-execution.error';
export { InvalidSyncJobStateError } from './domain/exceptions/invalid-sync-job-state.error';
export { SyncJobNotFoundError } from './domain/exceptions/sync-job-not-found.error';

// Infrastructure exports (for testing/mocking)
export { RedisStreamsJobEnqueueService } from './infrastructure/adapters/redis-streams-job-enqueue.service';
export { RetryClassifierRegistryService } from './infrastructure/adapters/retry-classifier-registry.service';
export { AuthFailureClassifierRegistryService } from './infrastructure/adapters/auth-failure-classifier-registry.service';
export { SchedulerTaskRegistryService } from './infrastructure/adapters/scheduler-task-registry.service';

// Scheduler task contract (consumed by integration modules to contribute cron tasks)
export type { SchedulerTaskConfig } from './domain/types/scheduler-task.types';

// Application Services (interfaces)
export type { ISyncJobRetryService } from './application/services/sync-job-retry.service.interface';
export type { ISyncJobBulkRetryService } from './application/services/sync-job-bulk-retry.service.interface';
export type { ISyncJobsService } from './application/services/sync-jobs.service.interface';
export type { ScheduleJobInput } from './application/services/sync-jobs.types';
export type { ISyncCursorsService } from './application/services/sync-cursors.service.interface';

// Inbound routing policy (ADR-015) — class is value-exported so the API webhooks
// module can bind it; deps (IIntegrationsService, JobEnqueuePort) resolve there.
export { InboundRoutingPolicyService } from './application/services/inbound-routing-policy.service';
export type { IInboundRoutingPolicyService } from './application/interfaces/inbound-routing-policy.service.interface';
export type { RoutingOutcome } from './application/types/inbound-routing-policy.types';

// Module and tokens
export { SyncModule } from './sync.module';
export * from './sync.tokens';

// ORM entities are exposed on the host-only `@openlinker/core/sync/orm-entities`
// sub-path (#594). Plugins must not import them from here.
// `ConnectionCursorOrmEntity` has no external consumer and is intentionally not
// promoted to the sub-barrel — add it if/when a test fixture needs it.
