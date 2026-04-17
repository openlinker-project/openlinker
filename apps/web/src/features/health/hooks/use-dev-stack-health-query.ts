import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { healthQueryKeys } from '../api/health.query-keys';
import type { DevStackHealth } from '../api/health.types';

export function useDevStackHealthQuery(
  options?: { refetchInterval?: number | false },
): UseQueryResult<DevStackHealth> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: healthQueryKeys.devStack(),
    queryFn: () => apiClient.health.getDevStackHealth(),
    retry: false,
    ...options,
  });
}
