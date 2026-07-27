/**
 * useSeriesAuditQuery
 *
 * Reads the gap-audit read model for a numbering series. Disabled when no series
 * is selected. `onlyGaps` narrows the entries to gap rows server-side.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { SeriesAudit } from '../api/numbering.types';

export function useSeriesAuditQuery(
  seriesId: string | null,
  options?: { onlyGaps?: boolean },
): UseQueryResult<SeriesAudit> {
  const apiClient = useApiClient();
  const onlyGaps = options?.onlyGaps ?? false;

  return useQuery<SeriesAudit>({
    queryKey: numberingQueryKeys.audit(seriesId ?? '', onlyGaps),
    enabled: Boolean(seriesId),
    queryFn: () => apiClient.invoiceNumbering.getSeriesAudit(seriesId ?? '', { onlyGaps }),
  });
}
