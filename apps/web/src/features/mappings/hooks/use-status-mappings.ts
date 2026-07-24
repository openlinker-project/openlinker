/**
 * Status Mappings Hooks
 *
 * TanStack Query hooks for fetching and mutating status mappings.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { StatusMapping, UpsertStatusMappingsPayload } from '../api/mappings.types';

export function useStatusMappingsQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<StatusMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    enabled: connectionId.length > 0 && (options?.enabled ?? true),
    queryKey: mappingsQueryKeys.status(connectionId),
    queryFn: () => apiClient.mappings.getStatusMappings(connectionId),
  });
}

export function useUpsertStatusMappings(
  connectionId: string
): UseMutationResult<StatusMapping[], Error, UpsertStatusMappingsPayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertStatusMappingsPayload) =>
      apiClient.mappings.upsertStatusMappings(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKeys.status(connectionId) });
    },
  });
}
