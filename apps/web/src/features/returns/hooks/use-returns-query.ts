import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnListResult } from '../api/returns.api';
import type { ReturnFilters, ReturnPagination } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useReturnsQuery(
  filters?: ReturnFilters,
  pagination?: ReturnPagination,
): UseQueryResult<ReturnListResult> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: returnsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.returns.list(filters, pagination),
  });
}
