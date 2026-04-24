import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { PaginatedOrders, OrderFilters, OrderPagination } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Optional query tuning. Currently only `staleTime` is exposed — consumers
 * that need full TanStack control should call `useQuery` with
 * `ordersQueryKeys.list(...)` directly.
 */
interface UseOrdersQueryOptions {
  staleTime?: number;
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
