/**
 * useNumberingSeriesQuery (#1577)
 *
 * Reads a single numbering series by id. Disabled when `seriesId` is null (the
 * assignment has no correction series), so the configured view can resolve the
 * optional correction card with a dependent query.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingSeries } from '../api/numbering.types';

export function useNumberingSeriesQuery(
  seriesId: string | null,
): UseQueryResult<NumberingSeries> {
  const apiClient = useApiClient();

  return useQuery<NumberingSeries>({
    queryKey: numberingQueryKeys.series(seriesId ?? ''),
    enabled: Boolean(seriesId),
    queryFn: () => apiClient.invoiceNumbering.getSeries(seriesId ?? ''),
  });
}
