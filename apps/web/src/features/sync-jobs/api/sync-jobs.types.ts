/**
 * Sync Jobs Feature Types
 *
 * Frontend transport types for the sync jobs API. Mirrors the backend
 * SyncJobResponseDto contract. All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/sync-jobs/api
 */

/**
 * Maximum page size accepted by the backend `GET /sync/jobs` endpoint.
 *
 * The server enforces `@Max(100)` in `apps/api/src/sync/http/dto/list-sync-jobs-query.dto.ts`
 * (and the same value on every other list DTO in the repo). Requesting `limit`
 * above this returns HTTP 400 with "limit must not be greater than 100".
 *
 * Keep this in sync with the backend validator. Any frontend caller that
 * pages through sync jobs should clamp to this value or lower.
 */
export const SYNC_JOBS_MAX_LIMIT = 100;

export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

export const JOB_TYPE_VALUES = [
  'marketplace.orders.poll',
  'marketplace.order.sync',
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'marketplace.offer.updateFields', // Internal job — not user-triggerable; listed here for status display only.
  'master.product.syncAll',
  'master.product.syncByExternalId',
  'master.inventory.syncAll',
  'master.inventory.syncByExternalId',
  'master.variants.autoMatch',
  'inventory.propagateToMarketplaces',
] as const;
export type JobType = (typeof JOB_TYPE_VALUES)[number];

export interface SyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  payloadJson: Record<string, unknown> | null;
  idempotencyKey: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobFilters {
  status?: JobStatus;
  connectionId?: string;
  jobType?: JobType;
}

export interface SyncJobPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedSyncJobs {
  items: SyncJob[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Aggregated dead-job signature from `GET /sync/jobs/grouped`. Each group
 * collapses all jobs sharing a `(connectionId, jobType)` signature into a
 * single row with a count, representative job id, and the group's last
 * error + most recent update time.
 */
export interface SyncJobGroup {
  connectionId: string;
  jobType: JobType;
  count: number;
  /** ISO 8601 string. */
  latestUpdatedAt: string;
  representativeJobId: string;
  lastError: string | null;
}

export interface SyncJobGroupsResponse {
  groups: SyncJobGroup[];
  totalGroups: number;
  totalJobs: number;
}

export interface SyncJobGroupsFilters {
  status: JobStatus;
  connectionId?: string;
  /** Max groups to return (server caps at 100). */
  limit?: number;
}

export interface RetryGroupedSyncJobsInput {
  connectionId: string;
  jobType: JobType;
}

export interface RetryGroupedSyncJobsResult {
  requeuedJobIds: string[];
  count: number;
  skipped: number;
}
