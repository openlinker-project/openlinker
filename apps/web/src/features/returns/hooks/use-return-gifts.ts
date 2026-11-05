/**
 * Return gifts hooks (#3943)
 *
 * @module apps/web/src/features/returns/hooks
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ReturnGift, ReturnGiftDecision, ReturnGifts } from '../api/return-gifts.api';

const key = (returnId: string): readonly unknown[] => ['returns', 'gifts', returnId];

export function useReturnGiftsQuery(returnId: string): UseQueryResult<ReturnGifts, Error> {
  const apiClient = useApiClient();
  return useQuery<ReturnGifts, Error>({
    queryKey: key(returnId),
    queryFn: () => apiClient.returnGifts.getReturnGifts(returnId),
    retry: false,
  });
}

export interface DecideReturnGiftVariables {
  giftLineId: string;
  decision: ReturnGiftDecision;
  deductionGross?: number;
}

export function useDecideReturnGiftMutation(
  returnId: string
): UseMutationResult<ReturnGift, Error, DecideReturnGiftVariables> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<ReturnGift, Error, DecideReturnGiftVariables>({
    mutationFn: ({ giftLineId, ...body }) =>
      apiClient.returnGifts.decideReturnGift(returnId, giftLineId, body),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: key(returnId) });
    },
  });
}
