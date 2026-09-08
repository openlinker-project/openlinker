/**
 * Orders list - the two-stage total (#2947)
 *
 * This is the read #2843 measured. At a million rows `GET /orders` took 149 ms,
 * of which 142 ms was `COUNT(*)` under a `syncStatus @> ...` jsonb containment
 * no plain index serves - 155x the paged query beside it, and about 540 MB
 * through the buffer pool per execution.
 *
 * The rows come from `useOrderRowsQuery`; this fetches the number beside them.
 *
 * @module features/orders/hooks
 */
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderFilters, OrderRecord } from '../api/orders.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import {
  inferTotalFromLoadedPage,
  usePaginatedTotal,
  type PaginatedTotalResult,
} from '../../../shared/hooks/use-paginated-total';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * @param page the rows the list has already rendered. A SHORT page carries its
 *   own exact total, so the count is then never requested at all - which is
 *   what keeps this change invisible on an install whose list fits one page.
 */
export function useOrdersTotal(
  filters: OrderFilters,
  page: RowsPage<OrderRecord> | undefined
): PaginatedTotalResult {
  const apiClient = useApiClient();

  return usePaginatedTotal({
    queryKey: ordersQueryKeys.count(filters),
    queryFn: ({ signal }) => apiClient.orders.count(filters, { signal }),
    selectTotal: (data) => data.total,
    knownTotal: inferTotalFromLoadedPage(page),
    enabled: page !== undefined,
  });
}
