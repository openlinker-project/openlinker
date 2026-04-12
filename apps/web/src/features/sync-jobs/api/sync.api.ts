/**
 * Sync Jobs API Client
 *
 * Thin API module for the sync jobs feature. Provides typed methods for
 * enqueueing, listing, and fetching individual sync jobs via the REST API.
 *
 * @module apps/web/src/features/sync-jobs/api
 */
import type {
  SyncJob,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
} from './sync-jobs.types';

export interface EnqueueSyncJobInput {
  connectionId: string;
  jobType: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface SyncJobResponse {
  jobId: string;
  status: string;
}

export interface SyncJobsApi {
  enqueue: (input: EnqueueSyncJobInput) => Promise<SyncJobResponse>;
  list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) => Promise<PaginatedSyncJobs>;
  getById: (id: string) => Promise<SyncJob>;
  retry: (id: string) => Promise<SyncJob>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: SyncJobFilters, pagination?: SyncJobPagination): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.jobType) params.set('jobType', filters.jobType);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createSyncJobsApi(request: ApiRequest): SyncJobsApi {
  return {
    enqueue(input): Promise<SyncJobResponse> {
      return request<SyncJobResponse>('/sync/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    list(filters, pagination): Promise<PaginatedSyncJobs> {
      return request<PaginatedSyncJobs>(`/sync/jobs${buildQuery(filters, pagination)}`);
    },
    getById(id): Promise<SyncJob> {
      return request<SyncJob>(`/sync/jobs/${id}`);
    },
    retry(id): Promise<SyncJob> {
      return request<SyncJob>(`/sync/jobs/${id}/retry`, { method: 'POST' });
    },
  };
}
