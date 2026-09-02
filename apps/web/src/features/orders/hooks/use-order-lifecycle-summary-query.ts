/**
 * Order Lifecycle-Phase Summary Query Hook
 *
 * Fetches the per-phase counts from `GET /orders/lifecycle-summary` (#2309),
 * backing the orders-list phase chip row (#2310). The nine phases partition the
 * set, so the buckets sum to `total`.
 *
 * Scoped by the same source + created-date axes as the table and deliberately
 * NOT by `phase` itself, so selecting a chip cannot self-filter the counts the
 * chips are rendered from. Mirrors the SLA-summary hook (#1108).
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderLifecyclePhaseSummary, OrderHealthSummaryFilters } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderLifecycleSummaryQuery(
  filters?: OrderHealthSummaryFilters,
): UseQueryResult<OrderLifecyclePhaseSummary> {
  const apiClient = useApiClient();

  // Eventually-consistent with the table, like its sibling summary hooks — any
  // orders-domain invalidation re-syncs the counts and the rows together.
  return useQuery({
    queryKey: ordersQueryKeys.lifecycleSummary(filters),
    queryFn: () => apiClient.orders.lifecycleSummary(filters),
  });
}
