/**
 * Acknowledge this parcel's buyer note (#3539, D12)
 *
 * Records who read the buyer's message at the bench, and when, for THIS parcel.
 * It never gates scanning and is not a parcel close (ADR-071), so nothing here
 * is awaited by the scan path and the hook takes no `expectedVersion`: the
 * acknowledgement is fill-once, not an optimistic write.
 *
 * The parcel comes back on EVERY outcome, a refusal included, and is written
 * into the cache so the box re-renders exactly as the server holds it. The
 * worklist is invalidated too: the rail row reads the same fact.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { BenchBuyerNoteAcknowledgementResult } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export function useBenchBuyerNoteAcknowledgeMutation(): UseMutationResult<
  BenchBuyerNoteAcknowledgementResult,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workId: string) => apiClient.bench.acknowledgeBuyerNote(workId),
    onSuccess: (result, workId) => {
      queryClient.setQueryData(benchQueryKeys.parcel(workId), result.parcel);
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.work() });
    },
  });
}
