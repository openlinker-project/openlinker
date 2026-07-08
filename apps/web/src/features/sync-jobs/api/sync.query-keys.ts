import type { SyncJobFilters, SyncJobPagination, SyncJobGroupsFilters } from './sync-jobs.types';

export const syncJobsQueryKeys = {
  all: ['sync-jobs'] as const,
  list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) =>
    ['sync-jobs', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['sync-jobs', 'detail', id] as const,
  webhookJobLookup: (platformType: string, connectionId: string, eventId: string) =>
    ['sync-jobs', 'webhook-job-lookup', platformType, connectionId, eventId] as const,
  grouped: (filters: SyncJobGroupsFilters) =>
    ['sync-jobs', 'grouped', filters] as const,
};
