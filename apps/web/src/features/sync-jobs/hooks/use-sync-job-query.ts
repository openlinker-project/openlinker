import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type { SyncJob } from '../api/sync-jobs.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useSyncJobQuery(id: string): UseQueryResult<SyncJob> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: syncJobsQueryKeys.detail(id),
    queryFn: () => apiClient.syncJobs.getById(id),
    enabled: Boolean(id),
  });
}
