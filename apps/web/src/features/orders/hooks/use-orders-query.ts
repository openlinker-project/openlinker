import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { PaginatedOrders, OrderFilters, OrderPagination } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Optional query tuning. `staleTime` and `enabled` are exposed — consumers
 * that need full TanStack control should call `useQuery` with
 * `ordersQueryKeys.list(...)` directly.
 */
interface UseOrdersQueryOptions {
  staleTime?: number;
  /**
   * Gate for probe-style callers (#2936): the command palette's Orders
   * source has no business firing before the palette is ever opened.
   */
  enabled?: boolean;
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
    enabled: options?.enabled ?? true,
  });
}
