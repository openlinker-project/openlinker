import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { systemQueryKeys } from '../api/system.query-keys';
import type { SystemConfig } from '../api/system.types';

export function useSystemConfigQuery(): UseQueryResult<SystemConfig> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: systemQueryKeys.config(),
    queryFn: () => apiClient.system.getConfig(),
    // Config never changes at runtime — fetch once and keep for the session.
    staleTime: Infinity,
  });
}
