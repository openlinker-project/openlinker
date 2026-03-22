import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AdapterSummary } from '../api/adapters.api';
import { adaptersQueryKeys } from '../api/adapters.query-keys';

export function useAdaptersQuery(): UseQueryResult<AdapterSummary[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: adaptersQueryKeys.list(),
    queryFn: () => apiClient.adapters.list(),
  });
}
