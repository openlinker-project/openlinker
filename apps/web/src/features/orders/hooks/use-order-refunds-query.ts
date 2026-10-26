/**
 * Order refunds query (#3541)
 *
 * The refunds the operator confirmed against one order. Decides whether the
 * cancel notice still has a refund to ask for and whether the timeline says
 * "Refund not confirmed yet".
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderRefundRecord } from '../api/order-refund.types';

export function useOrderRefundsQuery(internalOrderId: string): UseQueryResult<OrderRefundRecord[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.refunds(internalOrderId),
    queryFn: () => apiClient.orders.listRefunds(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
