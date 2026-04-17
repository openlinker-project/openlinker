import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { PaginatedOrders, OrderFilters, OrderPagination } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrdersQuery(
  filters?: OrderFilters,
  pagination?: OrderPagination,
): UseQueryResult<PaginatedOrders> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.orders.list(filters, pagination),
  });
}
