/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the sync module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/sync
 */

// Token for dependency injection (interfaces can't be used as values)
export const JOB_ENQUEUE_TOKEN = Symbol('JobEnqueuePort');
export const SYNC_JOB_REPOSITORY_TOKEN = Symbol('SyncJobRepositoryPort');
export const CONNECTION_CURSOR_REPOSITORY_TOKEN = Symbol('ConnectionCursorRepositoryPort');
export const SYNC_JOB_QUEUE_TOKEN = Symbol('SyncJobQueuePort');
export const SYNC_LOCK_TOKEN = Symbol('SyncLockPort');
export const SYNC_JOB_RETRY_SERVICE_TOKEN = Symbol('SyncJobRetryServicePort');
export const SYNC_JOB_BULK_RETRY_SERVICE_TOKEN = Symbol('SyncJobBulkRetryServicePort');
export const RETRY_CLASSIFIER_REGISTRY_TOKEN = Symbol('RetryClassifierRegistryService');
export const SCHEDULER_TASK_REGISTRY_TOKEN = Symbol('SchedulerTaskRegistryService');



