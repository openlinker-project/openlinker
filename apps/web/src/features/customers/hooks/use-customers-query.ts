import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { customersQueryKeys } from '../api/customers.query-keys';
import type {
  CustomerFilters,
  CustomerPagination,
  CustomerProjection,
  PaginatedCustomers,
} from '../api/customers.types';
import type { RowsPage } from '../../../shared/api/paginated-total.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * The page WITHOUT its total (#2947). Pair with `useCustomersTotal`.
 *
 * `useCustomersQuery` below still fetches both in one call and is kept for any
 * caller that genuinely wants them together.
 */
export function useCustomerRowsQuery(
  filters?: CustomerFilters,
  pagination?: CustomerPagination
): UseQueryResult<RowsPage<CustomerProjection>> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: customersQueryKeys.rows(filters, pagination),
    queryFn: () => apiClient.customers.listRows(filters, pagination),
  });
}

export function useCustomersQuery(
  filters?: CustomerFilters,
  pagination?: CustomerPagination
): UseQueryResult<PaginatedCustomers> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: customersQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.customers.list(filters, pagination),
  });
}
