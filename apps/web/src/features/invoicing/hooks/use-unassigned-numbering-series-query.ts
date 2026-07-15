/**
 * useUnassignedNumberingSeriesQuery (#1577)
 *
 * Reads the orphaned (unassigned) series list that backs the re-attach flow.
 * Each row carries its last-issued number so the operator can recognise a
 * series before re-attaching it.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { UnassignedNumberingSeries } from '../api/numbering.types';

export function useUnassignedNumberingSeriesQuery(): UseQueryResult<UnassignedNumberingSeries[]> {
  const apiClient = useApiClient();

  return useQuery<UnassignedNumberingSeries[]>({
    queryKey: numberingQueryKeys.unassigned(),
    queryFn: () => apiClient.invoiceNumbering.listUnassigned(),
  });
}
