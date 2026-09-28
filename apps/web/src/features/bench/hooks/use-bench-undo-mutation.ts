/**
 * Undo the single most recent scan on an OPEN parcel (#3405, mockup-parity
 * epic #3401)
 *
 * A lighter correction than reopen (`use-bench-reopen-mutation.ts`): no
 * token, no line id — the server locates and voids the last active
 * verification itself. A refusal is a 200 carrying its reason
 * (`parcel-closed` | `nothing-to-undo`), never an error, matching every
 * other bench write's discipline.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { BenchUndoResult } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export function useBenchUndoMutation(): UseMutationResult<BenchUndoResult, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workId: string) => apiClient.bench.undoLastScan(workId),
    onSuccess: (result, workId) => {
      // Returned on BOTH outcomes, so a refusal re-renders the box exactly as
      // it stands, the reopen mutation's own discipline.
      queryClient.setQueryData(benchQueryKeys.parcel(workId), result.parcel);
    },
  });
}
