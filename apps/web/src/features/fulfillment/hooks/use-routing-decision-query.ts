/**
 * Routing decision query (#2731, read by #3557)
 *
 * An order's latest routing decision. The endpoint answers 404 for an order that
 * has none, which is a normal answer and becomes `null`; any other failure
 * propagates, so "no decision" is never confused with "the read failed" (the
 * `useOrderInvoiceQuery` rule).
 *
 * `enabled` lets the page skip the read entirely when routing is not switched on,
 * so an install without routing makes no request and sees no 404.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { RoutingDecisionStatus } from '../api/fulfillment.types';

export function useRoutingDecisionQuery(
  orderId: string,
  options?: { enabled?: boolean }
): UseQueryResult<RoutingDecisionStatus | null> {
  const apiClient = useApiClient();

  return useQuery<RoutingDecisionStatus | null>({
    queryKey: fulfillmentQueryKeys.routingDecision(orderId),
    enabled: Boolean(orderId) && (options?.enabled ?? true),
    queryFn: async (): Promise<RoutingDecisionStatus | null> => {
      try {
        return await apiClient.fulfillment.getRoutingDecision(orderId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
