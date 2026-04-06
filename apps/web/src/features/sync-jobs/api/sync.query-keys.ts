import type { SyncJobFilters, SyncJobPagination } from './sync-jobs.types';

export const syncJobsQueryKeys = {
  all: ['sync-jobs'] as const,
  list: (filters?: SyncJobFilters, pagination?: SyncJobPagination) =>
    ['sync-jobs', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['sync-jobs', 'detail', id] as const,
};
