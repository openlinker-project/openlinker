import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { customersQueryKeys } from '../api/customers.query-keys';
import type { CustomerFilters, CustomerPagination, PaginatedCustomers } from '../api/customers.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCustomersQuery(
  filters?: CustomerFilters,
  pagination?: CustomerPagination,
): UseQueryResult<PaginatedCustomers> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: customersQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.customers.list(filters, pagination),
    retry: false,
  });
}
