import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type {
  PaginatedOrders,
  OrderFilters,
  OrderPagination,
  OrderRecord,
} from '../api/orders.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Optional query tuning. Currently only `staleTime` is exposed — consumers
 * that need full TanStack control should call `useQuery` with
 * `ordersQueryKeys.list(...)` directly.
 */
interface UseOrdersQueryOptions {
  staleTime?: number;
}

/**
 * The page WITHOUT its total (#2947). Pair with `useOrdersTotal`.
 *
 * `useOrdersQuery` below still fetches both in one call and is kept for any
 * caller that genuinely wants them together.
 */
export function useOrderRowsQuery(
  filters?: OrderFilters,
  pagination?: OrderPagination,
  options?: UseOrdersQueryOptions,
): UseQueryResult<RowsPage<OrderRecord>> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.rows(filters, pagination),
    queryFn: () => apiClient.orders.listRows(filters, pagination),
    staleTime: options?.staleTime,
  });
}

export function useOrdersQuery(
  filters?: OrderFilters,
  pagination?: OrderPagination,
  options?: UseOrdersQueryOptions,
): UseQueryResult<PaginatedOrders> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.orders.list(filters, pagination),
    staleTime: options?.staleTime,
  });
}
