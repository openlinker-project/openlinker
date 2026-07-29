/**
 * useCreateNumberingSeriesMutation (#1577)
 *
 * Creates a numbering series. Invalidates the numbering domain on success so
 * the series list, unassigned list, and any assignment view reflect it.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { CreateNumberingSeriesInput, NumberingSeries } from '../api/numbering.types';

export function useCreateNumberingSeriesMutation(): UseMutationResult<
  NumberingSeries,
  Error,
  CreateNumberingSeriesInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.invoiceNumbering.createSeries(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
