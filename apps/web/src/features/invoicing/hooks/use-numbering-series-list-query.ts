/**
 * useNumberingSeriesListQuery
 *
 * Reads all numbering series (newest first), optionally filtered by document
 * type / register. Backs the Series-tab table and the routing card's series
 * pickers.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { ListNumberingSeriesFilter, NumberingSeries } from '../api/numbering.types';

export function useNumberingSeriesListQuery(
  filter?: ListNumberingSeriesFilter,
): UseQueryResult<NumberingSeries[]> {
  const apiClient = useApiClient();

  return useQuery<NumberingSeries[]>({
    queryKey: numberingQueryKeys.seriesList(filter),
    queryFn: () => apiClient.invoiceNumbering.listSeries(filter),
  });
}
