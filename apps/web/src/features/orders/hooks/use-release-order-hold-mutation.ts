/**
 * Release Order Hold Mutation Hook (#2342)
 *
 * Ends a hold and reports what happened to the provisioning run it was
 * suppressing (#2341).
 *
 * The caller must read `provisioningResume` rather than treating the 2xx as
 * "the order is moving again": `marketplace.order.sync` has no scheduled task
 * covering one specific order, so a `failed` resume leaves it un-provisioned
 * until its destination is retried by hand. `describeProvisioningResume`
 * (`../lib/order-hold.types`) owns that copy.
 *
 * Invalidates the whole orders domain on success, same as its place sibling.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import { holdWriteErrorNeedsRefresh } from '../lib/order-hold-errors';
import type { ReleaseOrderHoldRequest, ReleaseOrderHoldResult } from '../api/orders.types';

export interface ReleaseOrderHoldInput extends ReleaseOrderHoldRequest {
  internalOrderId: string;
  holdId: string;
}

export function useReleaseOrderHoldMutation(): UseMutationResult<
  ReleaseOrderHoldResult,
  Error,
  ReleaseOrderHoldInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ internalOrderId, holdId, ...body }) =>
      apiClient.orders.releaseHold(internalOrderId, holdId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    },
    // A hold conflict means the server holds a truth this client does not, so
    // the surface refetches ITSELF rather than telling the operator to reload —
    // the copy in `describeHoldWriteError` used to ask them to do by hand what
    // every success path here already does. Any other failure leaves the cache
    // alone: it says nothing about staleness.
    onError: async (error: Error) => {
      if (holdWriteErrorNeedsRefresh(error)) {
        await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
      }
    },
  });
}
