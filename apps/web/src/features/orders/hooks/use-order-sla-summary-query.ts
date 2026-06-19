/**
 * Order SLA Summary Query Hook
 *
 * Fetches the per-ship-by-SLA-bucket counts from GET /orders/sla-summary
 * (#1108). Backs the orders-list "overdue / at-risk" KPI cells. The buckets
 * partition the set, so the counts sum to the total. Mirrors the status-summary
 * hook (#929).
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderSlaSummary, OrderHealthSummaryFilters } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderSlaSummaryQuery(
  filters?: OrderHealthSummaryFilters,
): UseQueryResult<OrderSlaSummary> {
  const apiClient = useApiClient();

  // Eventually-consistent with the table, same as the status-summary hook — the
  // retry mutation invalidates the whole orders domain, re-syncing counts + rows.
  return useQuery({
    queryKey: ordersQueryKeys.slaSummary(filters),
    queryFn: () => apiClient.orders.slaSummary(filters),
  });
}
