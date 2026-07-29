/**
 * useDeleteNumberingRouteMutation
 *
 * Detaches a connection's document-type numbering route (the series survives).
 * Invalidates the numbering domain on success.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { DeleteNumberingRouteInput } from '../api/numbering.types';

export interface DeleteNumberingRouteVariables {
  connectionId: string;
  input: DeleteNumberingRouteInput;
}

export function useDeleteNumberingRouteMutation(): UseMutationResult<
  void,
  Error,
  DeleteNumberingRouteVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, input }) =>
      apiClient.invoiceNumbering.deleteRoute(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
