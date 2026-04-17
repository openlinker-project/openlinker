import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { cursorsQueryKeys } from '../api/cursors.query-keys';
import type { PaginatedCursors, CursorFilters, CursorPagination } from '../api/cursors.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCursorsQuery(
  filters?: CursorFilters,
  pagination?: CursorPagination,
): UseQueryResult<PaginatedCursors> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: cursorsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.cursors.list(filters, pagination),
  });
}
