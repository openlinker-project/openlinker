/**
 * Order Status Summary Query Hook
 *
 * Fetches the per-derived-health-bucket counts from GET /orders/status-summary
 * (#929). Backs the orders-list status segments, whose counts partition the set
 * and therefore sum to the total — replacing the prior four overlapping
 * count-only list queries that left ingested/awaiting-mapping orders uncounted.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderHealthSummary, OrderHealthSummaryFilters } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderStatusSummaryQuery(
  filters?: OrderHealthSummaryFilters,
): UseQueryResult<OrderHealthSummary> {
  const apiClient = useApiClient();

  // No bespoke staleTime: the segment counts and the table are eventually
  // consistent by design. The retry mutation invalidates the whole orders
  // domain (`ordersQueryKeys.all`), so the counts and rows re-sync together on
  // the mutation path; any transient drift between background refetches is
  // cosmetic and acceptable for a triage summary.
  return useQuery({
    queryKey: ordersQueryKeys.statusSummary(filters),
    queryFn: () => apiClient.orders.statusSummary(filters),
  });
}
