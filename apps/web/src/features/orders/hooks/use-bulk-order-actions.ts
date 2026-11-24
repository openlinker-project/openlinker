/**
 * Bulk order action mutation hooks (#3619)
 *
 * Bulk cancel and bulk "mark buyer message read" (#3545). Both answer HTTP 200
 * with per-row outcomes even when rows failed, so a row failure never reaches
 * `onError`; only a whole-request failure (400, 403) does. Success invalidates
 * the whole orders domain because the list, the detail and the timeline all
 * show what changed.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type {
  BulkBuyerNoteReadResult,
  BulkCancelOrdersRequest,
  BulkCancelOrdersResult,
} from '../api/order-bulk-actions.types';

export function useBulkCancelOrdersMutation(): UseMutationResult<
  BulkCancelOrdersResult,
  Error,
  BulkCancelOrdersRequest
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiClient.orders.bulkCancelOrders(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}

export function useBulkMarkBuyerNoteReadMutation(): UseMutationResult<
  BulkBuyerNoteReadResult,
  Error,
  string[]
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderIds) => apiClient.orders.bulkMarkBuyerNoteRead(orderIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
  });
}
