/**
 * useNumberingRoutesQuery
 *
 * Reads a connection's document-type numbering routes. An empty array is the
 * "no routing configured yet" state (not a failure), so the Series tab renders
 * the routing card with every document type unassigned.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingRoute } from '../api/numbering.types';

export function useNumberingRoutesQuery(
  connectionId: string,
): UseQueryResult<NumberingRoute[]> {
  const apiClient = useApiClient();

  return useQuery<NumberingRoute[]>({
    queryKey: numberingQueryKeys.routes(connectionId),
    enabled: connectionId.length > 0,
    queryFn: () => apiClient.invoiceNumbering.listRoutes(connectionId),
  });
}
