/**
 * Declare a closed parcel finished and off the bench (pack-bench completion)
 *
 * Everything after the last scan — the label applied, the invoice inside, and
 * the box eventually leaving — was previously invisible: the parcel closing
 * (the last verification) records that the ITEMS are correct, never that the
 * packer is done with the box. This is the second, explicit act, and it is a
 * genuine write with a genuine control — unlike verification, which closes
 * with nothing to press (D18). It records the PACKER's own act, never a claim
 * that a carrier accepted the box — an unlabelled parcel is still marked done
 * here and leaves the bench for dispatch's queue, see
 * `BenchCompletionPanel`'s own docblock.
 *
 * `expectedVersion` is the token read WITH the parcel, the same rule
 * `useBenchReopenMutation` states: it says *"I acted on the box as I was shown
 * it"*, and a fresher value read at send time would make a stale-token
 * refusal unreachable.
 *
 * A refusal is a 200 carrying its own reason (`not-closed` | `already-completed`
 * | `version-conflict` | `not-claimable-by-viewer`), not an error, so it
 * resolves here exactly as a verification refusal does — the caller reads
 * `result.outcome` and `result.reason` and decides what to show.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchCompleteResult } from '../api/bench-parcel.types';

export interface BenchCompleteInput {
  readonly workId: string;
  /** From the parcel AS RENDERED. */
  readonly expectedVersion: number;
}

export function useBenchCompleteMutation(): UseMutationResult<
  BenchCompleteResult,
  Error,
  BenchCompleteInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, expectedVersion }: BenchCompleteInput) =>
      apiClient.bench.completeParcel(workId, expectedVersion),
    onSuccess: (result, variables) => {
      // Returned on every outcome, so a refusal re-renders the box exactly as
      // it stands rather than leaving a stale one on screen next to it.
      queryClient.setQueryData(benchQueryKeys.parcel(variables.workId), result.parcel);
      // A completion moves a row out of the "at this bench" sections
      // (`groupBenchWork`), so the rail must re-read rather than keep showing
      // it in the queue it just left.
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.work() });
    },
  });
}
