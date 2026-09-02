/**
 * useDeclineReturnMutation (#2336)
 *
 * The one return write OpenLinker performs.
 *
 * **Invalidation, never a cache seed.** The mutation result describes what the
 * SOURCE did; the persisted record is what the next read says. Seeding the
 * detail cache from the result would have to invent the header — in particular
 * it would have to decide what `declinedAt` now is, and for the `decline-sent`
 * outcome the honest answer is "still null, the source has not said". Refetching
 * is the only way the page states the record rather than the attempt.
 *
 * The list is invalidated by PREFIX (`returnsQueryKeys.all`) because its keys
 * carry filters and pagination, so no single key reaches every cached page. That
 * also re-reads `ingestion-availability`, which is cheap and cannot be wrong.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { DeclineReturnInput, DeclineReturnResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useDeclineReturnMutation(
  returnId: string,
): UseMutationResult<DeclineReturnResult, Error, DeclineReturnInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<DeclineReturnResult, Error, DeclineReturnInput>({
    mutationFn: (input) => apiClient.returns.decline(returnId, input),
    // `onSettled`, not `onSuccess`: a refused or conflicting attempt can still
    // have moved the record (the backend persists the proposal and the source's
    // refusal against it), so the page must re-read either way rather than keep
    // showing state from before the attempt.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(returnId) });
      await queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
}
