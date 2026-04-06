/**
 * Sync Job Types
 *
 * Defines types for sync job requests. Jobs are enqueued to Redis Streams
 * and consumed by workers to trigger synchronization operations.
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Job Type Values
 *
 * Runtime array of all valid job type values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const JobTypeValues = [
  // Generic (Option B)
  'marketplace.orders.poll',
  'marketplace.order.sync',
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'master.product.syncByExternalId',
  'master.inventory.syncByExternalId',

  // Internal orchestration (core-owned policies; executed by worker)
  'inventory.propagateToMarketplaces',
] as const;

/**
 * Job Type
 *
 * Derived union type from JobTypeValues. Provides type safety
 * without runtime overhead.
 */
export type JobType = (typeof JobTypeValues)[number];

/**
 * Job Status Values
 *
 * Runtime array of all valid job status values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const JobStatusValues = [
  'queued',
  'running',
  'succeeded',
  'dead',
] as const;

/**
 * Job Status
 *
 * Derived union type from JobStatusValues. Provides type safety
 * without runtime overhead.
 */
export type JobStatus = (typeof JobStatusValues)[number];

/**
 * Enqueue Job Result
 *
 * Returned by JobEnqueuePort.enqueueJob. Separates the job ID from the
 * idempotency flag so callers do not need to parse string prefixes.
 */
export interface EnqueueJobResult {
  /** Job ID assigned by the queue (stream message ID or existing job ID) */
  jobId: string;
  /** True when the idempotency key matched an already-enqueued job */
  isExisting: boolean;
}

/**
 * Sync Job Request
 *
 * Represents a sync job request to be enqueued. Jobs are published to
 * Redis Streams and consumed by workers that trigger synchronization
 * operations via adapters.
 */
export interface SyncJobRequest {
  /**
   * Job type identifier (e.g., 'marketplace.orders.poll')
   */
  jobType: JobType;

  /**
   * Connection identifier (UUID)
   */
  connectionId: string;

  /**
   * Job payload (provider-specific data)
   */
  payload: Record<string, unknown>;

  /**
   * Idempotency key (required for deduplication)
   * Format: {provider}:{connectionId}:{eventId}
   */
  idempotencyKey: string;
}

/**
 * Sync Job Filters
 *
 * Criteria for querying sync jobs. All fields are optional — omitting a field
 * means no filter is applied for that dimension.
 */
export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
}

/**
 * Sync Job Pagination
 *
 * Offset-based pagination parameters for sync job list queries.
 */
export interface SyncJobPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated Sync Jobs
 *
 * Result of a paginated sync job query.
 */
export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
}

/**
 * Sync Job (Persisted)
 *
 * Represents a persisted sync job in the database. Extends SyncJobRequest
 * with persistence fields (id, status, attempts, etc.).
 */
export interface SyncJob extends SyncJobRequest {
  /**
   * Job ID (UUID)
   */
  id: string;

  /**
   * Job status
   */
  status: JobStatus;

  /**
   * Number of execution attempts
   */
  attempts: number;

  /**
   * Maximum number of attempts before marking as dead
   */
  maxAttempts: number;

  /**
   * Next run timestamp (for retries)
   */
  nextRunAt: Date | string;

  /**
   * Lock timestamp (when job was locked by worker)
   */
  lockedAt?: Date | string | null;

  /**
   * Worker instance ID that locked the job
   */
  lockedBy?: string | null;

  /**
   * Last error message (if job failed)
   */
  lastError?: string | null;

  /**
   * Creation timestamp
   */
  createdAt: Date | string;

  /**
   * Last update timestamp
   */
  updatedAt: Date | string;
}

