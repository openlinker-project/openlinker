/**
 * Bench Source Change Taken Out Mutation (#3961)
 *
 * "Done, I took it out" on a box held because the shop lowered an item after
 * packing started. Invalidates every bench query on settle, like the claim
 * mutations: the answer can release the hold, which changes the work list too.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { BenchSourceChangeTakenOutResult } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export interface BenchSourceChangeTakenOutInput {
  readonly workId: string;
  readonly workLineId: string;
}

export function useBenchSourceChangeTakenOutMutation(): UseMutationResult<
  BenchSourceChangeTakenOutResult,
  Error,
  BenchSourceChangeTakenOutInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, workLineId }) => apiClient.bench.confirmSourceChangeTakenOut(workId, workLineId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.all });
    },
  });
}
