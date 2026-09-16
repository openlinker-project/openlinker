/**
 * useMatchReturnToOrderMutation (#2372/#2376)
 *
 * Attribute an orphan return to an order — the operator's way out of the
 * orphan bucket. **Attribution is monotonic: there is no unmatch.** A caller
 * must confirm before invoking this mutation; nothing here re-confirms.
 *
 * `onSettled`, not `onSuccess`: a lost race reports `already-attributed` (409)
 * and the return IS attributed by the time the caller sees the error — a
 * re-read is what surfaces the winning order rather than leaving the page
 * showing the pre-attempt orphan state.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { MatchReturnToOrderInput, MatchReturnToOrderResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useMatchReturnToOrderMutation(
  returnId: string
): UseMutationResult<MatchReturnToOrderResult, Error, MatchReturnToOrderInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<MatchReturnToOrderResult, Error, MatchReturnToOrderInput>({
    mutationFn: (input) => apiClient.returns.matchOrder(returnId, input),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(returnId) });
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
}
