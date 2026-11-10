/**
 * useCursorOverviewQuery (#4024)
 *
 * Every cursor grouped by connection with its last run (#4023).
 *
 * @module apps/web/src/features/cursors/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { cursorsQueryKeys } from '../api/cursors.query-keys';
import type { CursorOverview } from '../api/cursors.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/** A diagnostics page someone leaves open while waiting for a sync to move. */
const REFRESH_MS = 30_000;

/**
 * @param connectionId - read only this connection; the way to see all of one
 *   connection's bookmarks when the full overview is truncated
 */
export function useCursorOverviewQuery(connectionId?: string): UseQueryResult<CursorOverview> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: cursorsQueryKeys.overview(connectionId),
    queryFn: () => apiClient.cursors.overview(connectionId),
    refetchInterval: REFRESH_MS,
  });
}
