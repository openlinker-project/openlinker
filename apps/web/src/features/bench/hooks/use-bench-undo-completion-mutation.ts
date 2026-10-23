/**
 * Take back a completion, and keep every scan (#3415 mockup-parity)
 *
 * The counterpart to `useBenchCompleteMutation` that undoes the SECOND act
 * alone — never the first. A completion used to be a one-way door: the only
 * route back was reopen, which unpacks the whole box, so a packer who marked
 * the wrong parcel done had to re-scan a box that was already correct. This
 * clears `completedAt` and nothing else — every scan and the closed box
 * stand.
 *
 * `expectedVersion` is the token read WITH the parcel, the same rule
 * `useBenchCompleteMutation` states: it says *"I acted on the box as I was
 * shown it"*, and a fresher value read at send time would make a stale-token
 * refusal unreachable.
 *
 * A refusal is a 200 carrying its own reason (`not-completed` |
 * `version-conflict` | `not-claimable-by-viewer`), not an error, so it
 * resolves here exactly as a completion refusal does — the caller reads
 * `result.outcome` and `result.reason` and decides what to show.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchUndoCompletionResult } from '../api/bench-parcel.types';

export interface BenchUndoCompletionInput {
  readonly workId: string;
  /** From the parcel AS RENDERED. */
  readonly expectedVersion: number;
}

export function useBenchUndoCompletionMutation(): UseMutationResult<
  BenchUndoCompletionResult,
  Error,
  BenchUndoCompletionInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, expectedVersion }: BenchUndoCompletionInput) =>
      apiClient.bench.undoCompletion(workId, expectedVersion),
    onSuccess: (result, variables) => {
      // Returned on every outcome, so a refusal re-renders the box exactly as
      // it stands rather than leaving a stale one on screen.
      queryClient.setQueryData(benchQueryKeys.parcel(variables.workId), result.parcel);
      // A successful undo moves the row BACK into "at this bench" — the
      // mirror of `useBenchCompleteMutation`'s own invalidation, in the other
      // direction.
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.work() });
    },
  });
}
