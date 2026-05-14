/**
 * Payment Mappings Hooks
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
import type { PaymentMapping, UpsertPaymentMappingsPayload } from '../api/mappings.types';

export function usePaymentMappingsQuery(connectionId: string): UseQueryResult<PaymentMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.payments(connectionId),
    queryFn: () => apiClient.mappings.getPaymentMappings(connectionId),
  });
}

export function useUpsertPaymentMappings(
  connectionId: string
): UseMutationResult<PaymentMapping[], Error, UpsertPaymentMappingsPayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertPaymentMappingsPayload) =>
      apiClient.mappings.upsertPaymentMappings(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKeys.payments(connectionId) });
    },
  });
}
