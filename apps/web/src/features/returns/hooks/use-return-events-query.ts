/**
 * useReturnEventsQuery (#2646)
 *
 * One return's activity, for the return-detail timeline.
 *
 * Its own query rather than a field on the return read: the return detail is
 * already a fan-out of several reads, and a timeline that fails must not take
 * the record down with it.
 *
 * Disabled for an empty id, so a malformed URL asks the server nothing — the
 * `useReturnQuery` rule, applied to the same page.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnTimelineEntry } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useReturnEventsQuery(
  returnId: string
): UseQueryResult<ReturnTimelineEntry[], Error> {
  const apiClient = useApiClient();

  return useQuery<ReturnTimelineEntry[], Error>({
    queryKey: returnsQueryKeys.returnEvents(returnId),
    queryFn: () => apiClient.returns.listReturnEventsForReturn(returnId),
    enabled: returnId !== '',
  });
}
