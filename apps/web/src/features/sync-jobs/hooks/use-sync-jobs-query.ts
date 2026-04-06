import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type { PaginatedSyncJobs, SyncJobFilters, SyncJobPagination } from '../api/sync-jobs.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useSyncJobsQuery(
  filters?: SyncJobFilters,
  pagination?: SyncJobPagination,
): UseQueryResult<PaginatedSyncJobs> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: syncJobsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.syncJobs.list(filters, pagination),
    retry: false,
  });
}
