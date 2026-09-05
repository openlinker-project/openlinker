/**
 * Bench expedite mutation (#2416, `W3b-3`, story B5 / D22)
 *
 * Moves one parcel ahead of ordinary deadline order, or puts it back.
 *
 * ## `expectedVersion` comes from the ROW as it was rendered
 *
 * Never re-read from the cache at send time — the `useFulfillmentTaskActionMutation`
 * rule, and for the same reason: the token says *"I acted on the parcel as I was
 * shown it"*, and substituting a fresher value would make a conflict unreachable
 * and hand the last writer the win.
 *
 * ## Invalidate the whole bench, not one row
 *
 * An expedite changes the ORDER of the list, not just the row that moved — every
 * other row's position shifts under it. A narrow invalidation would leave the
 * queue rendered in the old order with one row wearing a new badge, which is
 * precisely the silently-reordering list D22 forbids.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export interface BenchExpediteInput {
  readonly workId: string;
  /** Whichever verb the server offered. The direction is never decided here. */
  readonly action: 'expedite' | 'release_expedite';
  readonly expectedVersion: number;
}

export function useBenchExpediteMutation(): UseMutationResult<void, Error, BenchExpediteInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ workId, action, expectedVersion }: BenchExpediteInput) => {
      await apiClient.bench.setExpedited(workId, action, expectedVersion);
    },
    // On BOTH outcomes. A failure here is usually a stale token, which means
    // the server holds a truth this client does not — so the refetch is the
    // re-render, and the packer sees the real order rather than their own
    // optimistic guess at it.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.all });
    },
  });
}
