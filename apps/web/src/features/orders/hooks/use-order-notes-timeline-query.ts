/**
 * Order Notes Timeline Query Hook (#3531)
 *
 * The notes' authored acts (added / edited / flag changed / deleted) for the
 * order Activity timeline. Its own key under the order's notes key, so every
 * note mutation — which invalidates `ordersQueryKeys.notes(id)` — refreshes
 * the timeline too, by prefix.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderNoteTimelineEntry } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderNotesTimelineQuery(
  internalOrderId: string,
): UseQueryResult<OrderNoteTimelineEntry[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: [...ordersQueryKeys.notes(internalOrderId), 'timeline'] as const,
    queryFn: () => apiClient.orders.listNoteTimeline(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
