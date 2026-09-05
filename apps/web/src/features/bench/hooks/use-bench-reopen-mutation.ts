/**
 * Reopen a box closed by mistake (#2418, `W3b-5`, story E6 / D19)
 *
 * Load-bearing because of auto-close (D18): the parcel shuts on the last
 * verification, which removes the pause in which a mis-scan would have been
 * caught. Reopening is therefore the only correction path this surface has.
 *
 * `expectedVersion` is the token read WITH the parcel, never re-read from the
 * cache at send time — the `useBenchExpediteMutation` rule, for the same reason:
 * the token says *"I acted on the box as I was shown it"*, and substituting a
 * fresher value would make D21's conflict unreachable and hand the last writer
 * the win.
 *
 * A refusal is a 200 carrying its reason rather than an error, so it resolves
 * here and the surface tells the packer WHICH refusal it was — `shipped` and
 * `not-closed` have nothing in common but their status code.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchReopenResult } from '../api/bench-parcel.types';

export interface BenchReopenInput {
  readonly workId: string;
  /** From the parcel AS RENDERED. */
  readonly expectedVersion: number;
}

export function useBenchReopenMutation(): UseMutationResult<
  BenchReopenResult,
  Error,
  BenchReopenInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, expectedVersion }: BenchReopenInput) =>
      apiClient.bench.reopenParcel(workId, expectedVersion),
    onSuccess: (result, variables) => {
      // Returned on BOTH outcomes, so a refusal re-renders the box exactly as it
      // stands rather than leaving a stale one on screen next to a refusal.
      queryClient.setQueryData(benchQueryKeys.parcel(variables.workId), result.parcel);
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.work() });
    },
  });
}
