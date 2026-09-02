/**
 * useOrderReturnEventsQuery (#2383)
 *
 * One order's return activity, for the order-detail timeline.
 *
 * Its own query rather than a field on the order read: it spans returns the
 * order does not own, and an order with no returns must cost the timeline
 * nothing. A failure is **non-fatal by design** — the order page still renders
 * its own history, one section shorter, because a returns read that could not
 * answer must not take the order's timeline down with it.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnTimelineEntry } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderReturnEventsQuery(
  internalOrderId: string | null
): UseQueryResult<ReturnTimelineEntry[], Error> {
  const apiClient = useApiClient();

  return useQuery<ReturnTimelineEntry[], Error>({
    queryKey: returnsQueryKeys.orderEvents(internalOrderId ?? ''),
    queryFn: () => apiClient.returns.listReturnEventsForOrder(internalOrderId ?? ''),
    enabled: internalOrderId !== null && internalOrderId.length > 0,
  });
}
