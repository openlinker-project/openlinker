/**
 * useUpdateNumberingSeriesMutation (#1577)
 *
 * Patches an existing numbering series. Invalidates the numbering domain on
 * success.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingSeries, UpdateNumberingSeriesInput } from '../api/numbering.types';

export interface UpdateNumberingSeriesVariables {
  seriesId: string;
  input: UpdateNumberingSeriesInput;
}

export function useUpdateNumberingSeriesMutation(): UseMutationResult<
  NumberingSeries,
  Error,
  UpdateNumberingSeriesVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ seriesId, input }) => apiClient.invoiceNumbering.updateSeries(seriesId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
