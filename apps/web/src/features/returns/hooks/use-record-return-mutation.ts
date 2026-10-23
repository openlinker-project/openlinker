/**
 * useRecordReturnMutation (#2372/#2376)
 *
 * Open a return in OpenLinker by hand, for a channel with no returns feed at
 * all. Unlike the other two orphan/manual writes this one addresses no
 * EXISTING return — there is no `returnId` to invalidate a detail cache for
 * ahead of the call, so the list is the only cache this mutation can be sure
 * is stale.
 *
 * `onSuccess`, not `onSettled`: a refused `record` (400 — `no-lines`,
 * `invalid-quantity`, `unknown-order`, `order-not-on-connection`) creates
 * nothing, so there is nothing new to invalidate on the failure path. The
 * newly-created return's own detail is invalidated too, from the result's
 * `returnId` — a caller that navigates straight to it after a successful
 * record must not hit a cold, unpopulated cache.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { RecordReturnInput, RecordReturnResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useRecordReturnMutation(): UseMutationResult<
  RecordReturnResult,
  Error,
  RecordReturnInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<RecordReturnResult, Error, RecordReturnInput>({
    mutationFn: (input) => apiClient.returns.record(input),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(result.returnId) });
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
}
