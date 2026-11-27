/**
 * useWriteMarksQuery (#4024)
 *
 * One connection's per-listing stock write marks, fetched only when the
 * operator opens the summary row. There can be thousands, so one page.
 *
 * @module apps/web/src/features/cursors/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { cursorsQueryKeys } from '../api/cursors.query-keys';
import type { PaginatedCursors } from '../api/cursors.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export const WRITE_MARKS_PAGE = 50;

export function useWriteMarksQuery(
  connectionId: string,
  keyPrefix: string,
  enabled: boolean
): UseQueryResult<PaginatedCursors> {
  const apiClient = useApiClient();
  const filters = { connectionId, keyPrefix };
  const pagination = { limit: WRITE_MARKS_PAGE, offset: 0 };
  return useQuery({
    queryKey: cursorsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.cursors.list(filters, pagination),
    enabled,
  });
}
