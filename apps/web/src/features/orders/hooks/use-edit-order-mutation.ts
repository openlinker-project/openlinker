/**
 * Edit Order Mutation Hook (#3544)
 *
 * One mutation for the four edit endpoints (address, lines, delivery method,
 * discount), so the dialog drives a dry run and a save through one call shape.
 *
 * **A dry run invalidates nothing.** It writes nothing, and refetching the order
 * underneath an open review would re-seed the dialog's defaults from a state the
 * operator has not saved. A real edit refetches the orders domain: the snapshot
 * is the order AS EDITED, so every panel reads it. A refusal that proves the
 * page is stale (packed, shipped, cancelled, contended) refetches too, the
 * `use-cancel-order-mutation` shape. Invoice, shipment and fulfilment-task
 * queries live outside this feature, so the page invalidates those in `onSaved`.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type {
  OrderDiscountResult,
  OrderEditRequest,
  OrderEditResult,
} from '../api/order-edit.types';
import { orderEditErrorNeedsRefresh, readOrderEditErrorCode } from '../lib/order-edit';

export interface EditOrderInput {
  internalOrderId: string;
  edit: OrderEditRequest;
}

/** The address / lines / delivery-method result, or the discount's. Narrow on the request kind. */
export type EditOrderOutput = OrderEditResult | OrderDiscountResult;

export function useEditOrderMutation(): UseMutationResult<EditOrderOutput, Error, EditOrderInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<EditOrderOutput, Error, EditOrderInput>({
    mutationFn: ({ internalOrderId, edit }): Promise<EditOrderOutput> => {
      switch (edit.kind) {
        case 'address':
          return apiClient.orders.editOrderAddress(internalOrderId, edit.body);
        case 'lines':
          return apiClient.orders.editOrderLines(internalOrderId, edit.body);
        case 'delivery-method':
          return apiClient.orders.editOrderDeliveryMethod(internalOrderId, edit.body);
        case 'discount':
          return apiClient.orders.editOrderDiscount(internalOrderId, edit.body);
      }
    },
    onSuccess: async (_result, { edit }) => {
      if (edit.body.dryRun === true) return;
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
    onError: async (error: Error) => {
      if (orderEditErrorNeedsRefresh(readOrderEditErrorCode(error))) {
        await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
      }
    },
  });
}
