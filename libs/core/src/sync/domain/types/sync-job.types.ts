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
  'prestashop.product.syncByExternalId',
  'prestashop.inventory.syncByExternalId',
  'prestashop.order.syncByExternalId',
] as const;

/**
 * Job Type
 *
 * Derived union type from JobTypeValues. Provides type safety
 * without runtime overhead.
 */
export type JobType = (typeof JobTypeValues)[number];

/**
 * Sync Job
 *
 * Represents a sync job request to be enqueued. Jobs are published to
 * Redis Streams and consumed by workers that trigger synchronization
 * operations via adapters.
 */
export interface SyncJob {
  /**
   * Job type identifier (e.g., 'prestashop.product.syncByExternalId')
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

