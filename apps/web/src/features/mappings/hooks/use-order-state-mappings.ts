/**
 * Order-State Mappings Hooks (#862)
 *
 * Outbound OL→destination order-state override mapping, scoped per destination
 * connection. Mirrors the carrier-mapping hooks.
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
import type { OrderStateMapping, UpsertOrderStateMappingsPayload } from '../api/mappings.types';

export function useOrderStateMappingsQuery(
  connectionId: string,
  options?: { enabled?: boolean }
): UseQueryResult<OrderStateMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    enabled: connectionId.length > 0 && (options?.enabled ?? true),
    queryKey: mappingsQueryKeys.orderStates(connectionId),
    queryFn: () => apiClient.mappings.getOrderStateMappings(connectionId),
  });
}

export function useUpsertOrderStateMappings(
  connectionId: string
): UseMutationResult<OrderStateMapping[], Error, UpsertOrderStateMappingsPayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertOrderStateMappingsPayload) =>
      apiClient.mappings.upsertOrderStateMappings(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mappingsQueryKeys.orderStates(connectionId),
      });
    },
  });
}
