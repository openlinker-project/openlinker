/**
 * Replace a box's label with corrected parcel data (#3655, backend #3654)
 *
 * A refusal resolves (see `BenchApi.replaceLabel`) so the dialog can say WHICH
 * one it was. Only the two outcomes that changed something invalidate the
 * documents read: on `replaced` the card must show the new label, and on
 * `cancelled-not-replaced` the old one is void and must stop offering a print.
 * A refusal leaves the old label untouched, so nothing is refetched.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { BenchLabelReplaceInput, BenchLabelReplaceResult } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export interface BenchReplaceLabelVariables {
  readonly workId: string;
  readonly input: BenchLabelReplaceInput;
}

export function useBenchReplaceLabelMutation(): UseMutationResult<
  BenchLabelReplaceResult,
  Error,
  BenchReplaceLabelVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, input }: BenchReplaceLabelVariables) =>
      apiClient.bench.replaceLabel(workId, input),
    onSuccess: (result, variables) => {
      if (result.outcome === 'refused') return;
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.documents(variables.workId) });
    },
  });
}
