/**
 * useUpsertNumberingRouteMutation
 *
 * Creates or replaces a connection's document-type numbering route. Invalidates
 * the numbering domain on success — the routes list and (indirectly) the
 * Actions-row status both change.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingRoute, UpsertNumberingRouteInput } from '../api/numbering.types';

export interface UpsertNumberingRouteVariables {
  connectionId: string;
  input: UpsertNumberingRouteInput;
}

export function useUpsertNumberingRouteMutation(): UseMutationResult<
  NumberingRoute,
  Error,
  UpsertNumberingRouteVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, input }) =>
      apiClient.invoiceNumbering.upsertRoute(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
