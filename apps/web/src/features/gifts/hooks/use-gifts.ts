/**
 * Gifts - order-side hooks (#3940)
 *
 * The manual add-gift edit and the order's gift-attention reads. The promotion
 * queries live in `features/promotions`.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';
import { giftsQueryKeys } from '../api/gifts.query-keys';
import type {
  AddGiftInput,
  AddGiftResult,
  GiftAttentionEntry,
  GiftAttentionResult,
} from '../api/gifts.types';

export function useAddGiftMutation(
  internalOrderId: string,
): UseMutationResult<AddGiftResult, ApiError, AddGiftInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.gifts.addGiftToOrder(internalOrderId, input),
    onSuccess: (result) => {
      if (result.dryRun) return;
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      void queryClient.invalidateQueries({ queryKey: giftsQueryKeys.all });
    },
  });
}

export function useGiftAttentionQuery(internalOrderId: string): UseQueryResult<GiftAttentionResult> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftsQueryKeys.attention(internalOrderId),
    queryFn: () => apiClient.gifts.getGiftAttention(internalOrderId),
    enabled: internalOrderId.length > 0,
  });
}

export function useSkipGiftAttentionMutation(
  internalOrderId: string,
): UseMutationResult<GiftAttentionEntry, ApiError, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => apiClient.gifts.skipGiftAttention(internalOrderId, runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: giftsQueryKeys.attention(internalOrderId) });
    },
  });
}
