/**
 * usePaginatedConnectionsQuery
 *
 * The connections list PAGE's read (#2937) — genuinely paged, with a total
 * count, so the surface actually rendering a growing connections table
 * scales with it. Every other connections reader (capability pickers,
 * lookup tables, the command palette) should keep using
 * `useConnectionsQuery`, which stays unbounded on purpose: those callers
 * need EVERY connection matching a filter to search/filter client-side,
 * and defaulting them to one page would silently truncate results on the
 * exact install shape (many connections) this pagination exists to serve.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type {
  ConnectionFilters,
  ConnectionPagination,
  PaginatedConnections,
} from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function usePaginatedConnectionsQuery(
  filters: ConnectionFilters | undefined,
  pagination: ConnectionPagination,
): UseQueryResult<PaginatedConnections> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.listPaginated(filters, pagination),
    queryFn: () => apiClient.connections.listPaginated(filters, pagination),
  });
}
