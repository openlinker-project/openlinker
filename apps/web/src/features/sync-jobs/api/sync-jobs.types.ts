/**
 * Sync Jobs Feature Types
 *
 * Frontend transport types for the sync jobs API. Mirrors the backend
 * SyncJobResponseDto contract. All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/sync-jobs/api
 */

export const JOB_STATUS_VALUES = ['queued', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

export const JOB_TYPE_VALUES = [
  'marketplace.orders.poll',
  'marketplace.order.sync',
  'marketplace.offers.sync',
  'marketplace.offerQuantity.update',
  'master.product.syncByExternalId',
  'master.inventory.syncByExternalId',
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
