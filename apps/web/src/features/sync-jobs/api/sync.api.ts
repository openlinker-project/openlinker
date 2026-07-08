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
  SyncJobGroupsResponse,
  SyncJobGroupsFilters,
  RetryGroupedSyncJobsInput,
  RetryGroupedSyncJobsResult,
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

/**
 * Raw components of an inbound webhook event, from which the server assembles
 * the inbound-job idempotency key to resolve the job it enqueued (#1366).
 */
export interface WebhookJobLookupInput {
  platformType: string;
  connectionId: string;
  eventId: string;
}

export interface SyncJobsApi {
  enqueue: (input: EnqueueSyncJobInput) => Promise<SyncJobResponse>;
  /**
   * List sync jobs with optional filters and pagination.
   *
   * NOTE: The backend enforces `pagination.limit` <= `SYNC_JOBS_MAX_LIMIT`
   * (100); values above that return HTTP 400 with
   * "limit must not be greater than 100". Callers that need a higher page
   * size should import `SYNC_JOBS_MAX_LIMIT` from `./sync-jobs.types` and
   * clamp explicitly, or paginate via `offset`.
   */
  list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) => Promise<PaginatedSyncJobs>;
  getById: (id: string) => Promise<SyncJob>;
  /**
   * Resolve the persisted SyncJob a webhook trigger enqueued (#1366). The
   * caller passes the raw components of the inbound event (a webhook delivery
   * holds all three); the server assembles the idempotency key, so the format
   * lives only in core and is never re-encoded here. Rejects with a 404
   * `ApiError` when no job exists yet (worker hasn't created the row), which
   * the caller treats as "not resolvable".
   */
  lookupJobForWebhookEvent: (input: WebhookJobLookupInput) => Promise<SyncJob>;
  retry: (id: string) => Promise<SyncJob>;
  /**
   * List sync jobs aggregated by (connectionId, jobType). Server caps the
   * returned `groups` array at 100 — the full `totalGroups` count is in
   * the response so the UI can render "top N of M".
   */
  listGrouped: (filters: SyncJobGroupsFilters) => Promise<SyncJobGroupsResponse>;
  /**
   * Re-queue every dead job matching the group selector. Server caps the
   * batch size; any jobs that flipped out of `dead` mid-flight are counted
   * as `skipped` in the response.
   */
  retryGrouped: (input: RetryGroupedSyncJobsInput) => Promise<RetryGroupedSyncJobsResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: SyncJobFilters, pagination?: SyncJobPagination): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.jobType) params.set('jobType', filters.jobType);
  if (filters?.outcome) params.set('outcome', filters.outcome);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

function buildGroupedQuery(filters: SyncJobGroupsFilters): string {
  const params = new URLSearchParams();
  params.set('status', filters.status);
  if (filters.connectionId) params.set('connectionId', filters.connectionId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  return `?${params.toString()}`;
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
    lookupJobForWebhookEvent(input): Promise<SyncJob> {
      const params = new URLSearchParams({
        platformType: input.platformType,
        connectionId: input.connectionId,
        eventId: input.eventId,
      });
      return request<SyncJob>(`/sync/jobs/lookup?${params.toString()}`);
    },
    retry(id): Promise<SyncJob> {
      return request<SyncJob>(`/sync/jobs/${id}/retry`, { method: 'POST' });
    },
    listGrouped(filters): Promise<SyncJobGroupsResponse> {
      return request<SyncJobGroupsResponse>(`/sync/jobs/grouped${buildGroupedQuery(filters)}`);
    },
    retryGrouped(input): Promise<RetryGroupedSyncJobsResult> {
      return request<RetryGroupedSyncJobsResult>('/sync/jobs/retry-grouped', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
