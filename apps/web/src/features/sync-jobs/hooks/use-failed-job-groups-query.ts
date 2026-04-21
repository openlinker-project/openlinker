/**
 * Failed Job Groups Query Hook
 *
 * Reads the server-aggregated view of sync job failure signatures
 * (`GET /sync/jobs/grouped`). Default filter is `{ status: 'dead' }`
 * — the dashboard's triage surface.
 *
 * @module apps/web/src/features/sync-jobs/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type { SyncJobGroupsFilters, SyncJobGroupsResponse } from '../api/sync-jobs.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useFailedJobGroupsQuery(
  filters: SyncJobGroupsFilters = { status: 'dead' },
  options?: { refetchInterval?: number | false },
): UseQueryResult<SyncJobGroupsResponse> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: syncJobsQueryKeys.grouped(filters),
    queryFn: () => apiClient.syncJobs.listGrouped(filters),
    ...options,
  });
}
