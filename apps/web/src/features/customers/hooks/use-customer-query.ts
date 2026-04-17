import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { customersQueryKeys } from '../api/customers.query-keys';
import type { CustomerProjectionDetail } from '../api/customers.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCustomerQuery(id: string): UseQueryResult<CustomerProjectionDetail> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: customersQueryKeys.detail(id),
    queryFn: () => apiClient.customers.getById(id),
    enabled: id.length > 0,
  });
}
