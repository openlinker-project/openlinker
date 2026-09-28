/**
 * Claim an unassigned parcel — by id, or let the system pick (#3412, #3416,
 * mockup-parity epic #3401)
 *
 * The mockup's own comment records these as ONE underlying move, `claimRow`,
 * shared between "Claim this parcel" (the packer picks which one) and "Take
 * next task" (the server picks — oldest deadline first among the unassigned).
 * They stay two mutations here because they hit two endpoints and return two
 * result shapes, but both invalidate the same `benchQueryKeys.all` — a claim
 * changes which SECTION a row belongs in, not just a field on it, so a narrow
 * invalidation would leave the row rendered in its old section with a new
 * badge, the same reasoning `use-bench-expedite-mutation.ts` already states
 * for reordering.
 *
 * Neither mutation opens the claimed parcel. The mockup's `claimRow` only
 * moves the row into "Assigned to you" and toasts — it does not navigate,
 * because claiming and opening are two separate acts a packer may want apart
 * (claim several, then work through them in order).
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { BenchClaimNextResult, BenchClaimResult } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export function useBenchClaimMutation(): UseMutationResult<BenchClaimResult, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workId: string) => apiClient.bench.claimParcel(workId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.all });
    },
  });
}

export function useBenchClaimNextMutation(): UseMutationResult<BenchClaimNextResult, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.bench.claimNext(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.all });
    },
  });
}
