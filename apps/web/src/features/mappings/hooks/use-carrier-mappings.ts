/**
 * Carrier Mappings Hooks
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { CarrierMapping, UpsertCarrierMappingsPayload } from '../api/mappings.types';

export function useCarrierMappingsQuery(connectionId: string): UseQueryResult<CarrierMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.carriers(connectionId),
    queryFn: () => apiClient.mappings.getCarrierMappings(connectionId),
  });
}

export function useUpsertCarrierMappings(connectionId: string): UseMutationResult<CarrierMapping[], Error, UpsertCarrierMappingsPayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertCarrierMappingsPayload) =>
      apiClient.mappings.upsertCarrierMappings(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKeys.carriers(connectionId) });
    },
  });
}
