import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnListResult } from '../api/returns.api';
import type { ReturnFilters, ReturnPagination } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * `enabled` is a THIRD argument rather than a caller-side early return (#2640).
 *
 * `buildQuery` omits a falsy filter value, so a caller holding an empty scoping
 * id would silently issue an UNFILTERED list read — every return in the
 * installation, rendered under a heading claiming they belong to one order. A
 * caller that can hold an empty id passes `false` here; the default `true`
 * leaves every existing caller unchanged.
 */
export function useReturnsQuery(
  filters?: ReturnFilters,
  pagination?: ReturnPagination,
  enabled = true,
): UseQueryResult<ReturnListResult> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: returnsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.returns.list(filters, pagination),
    enabled,
  });
}
