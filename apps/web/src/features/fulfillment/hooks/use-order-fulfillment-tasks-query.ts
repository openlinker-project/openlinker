/**
 * Order fulfilment-tasks query (#2411)
 *
 * Every fulfilment task covering one order. A separate read rather than a field
 * on `GET /orders/:id`: the order projection is already large, and an order that
 * was never routed has no tasks at all.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { FulfillmentTaskPage } from '../api/fulfillment.types';

export function useOrderFulfillmentTasksQuery(
  orderId: string
): UseQueryResult<FulfillmentTaskPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: fulfillmentQueryKeys.worksByOrder(orderId),
    queryFn: () => apiClient.fulfillment.listByOrder(orderId),
    enabled: Boolean(orderId),
  });
}
