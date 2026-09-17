/**
 * useRecordCorrectionProposalMutation (#3089)
 *
 * Records the credit-note correction proposal for review (#2376, `W2-39`).
 *
 * **Seeded, not invalidated — the one deliberate exception to this feature's
 * "invalidation, never a cache seed" rule.** `use-decline-return-mutation` and
 * `use-return-custody-mutations` refetch because their responses describe an
 * ATTEMPT, not the full state a page renders. This response is different: the
 * backend documents it as "the same computation as the GET, additionally
 * recorded" — so it IS what a fresh preview read would answer, plus the
 * `changeId`/`opened` fields the GET never carries. Refetching would spend a
 * network round trip to re-derive a number already in hand, and could in
 * principle race a concurrent change to the underlying invoice/return state
 * and silently disagree with what was just recorded.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnCorrectionProposalResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useRecordCorrectionProposalMutation(
  returnId: string,
): UseMutationResult<ReturnCorrectionProposalResult, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ReturnCorrectionProposalResult, Error, void>({
    mutationFn: () => apiClient.returns.recordCorrectionProposal(returnId),
    onSuccess: (result) => {
      queryClient.setQueryData(returnsQueryKeys.correctionProposal(returnId), result);
    },
  });
}
