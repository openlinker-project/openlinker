/**
 * Order-line suggestion query and confirmation (#3933)
 *
 * The suggestion is a read; the confirmation goes through the same
 * fill-in-when-empty claim as automatic resolution, so it can never overwrite
 * an answer. Both live here because a confirmation must refresh the suggestion
 * and the return detail together.
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
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnOrderLineSuggestion } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderLineSuggestionQuery(
  returnId: string,
  lineId: string,
  enabled: boolean
): UseQueryResult<ReturnOrderLineSuggestion, Error> {
  const apiClient = useApiClient();
  return useQuery<ReturnOrderLineSuggestion, Error>({
    queryKey: returnsQueryKeys.orderLineSuggestion(returnId, lineId),
    queryFn: () => apiClient.returns.getOrderLineSuggestion(returnId, lineId),
    enabled,
    retry: false,
  });
}

export function useConfirmOrderLineMutation(
  returnId: string,
  lineId: string
): UseMutationResult<{ claimed: boolean }, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<{ claimed: boolean }, Error, string>({
    mutationFn: (orderLineId) => apiClient.returns.confirmOrderLine(returnId, lineId, orderLineId),
    onSettled: async () => {
      // The list's stage counters and the correction proposal read this line.
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(returnId) });
      await queryClient.invalidateQueries({
        queryKey: returnsQueryKeys.orderLineSuggestion(returnId, lineId),
      });
    },
  });
}
