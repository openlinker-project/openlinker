/**
 * Fulfilment worklist query (#2410)
 *
 * The filtered, paged read behind the standalone worklist. A sibling of
 * `use-order-fulfillment-tasks-query.ts` rather than a replacement: that one is
 * order-scoped and keyed `worksByOrder`, this one is filter-scoped and keyed
 * `list(filters)`. Both keys live under `fulfillmentQueryKeys.all`, which is
 * what the action mutation invalidates — so an action taken on either surface
 * refreshes the other.
 *
 * ## The requested page size is a REQUEST, not a fact
 *
 * The server clamps `limit` (#2406), so the response reports what it actually
 * applied. Nothing here reads the requested value back; the pager reads
 * `page.limit` / `page.offset` off the response.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { FulfillmentTaskFilters, FulfillmentTaskPage } from '../api/fulfillment.types';

/**
 * What the worklist asks for. The server's own default is 25 and it clamps
 * anything larger, so this is deliberately the same number — asking for more
 * than the server will give makes the request a lie about the page it gets.
 */
export const FULFILLMENT_WORKLIST_PAGE_SIZE = 25;

export function useFulfillmentTasksQuery(
  filters: FulfillmentTaskFilters
): UseQueryResult<FulfillmentTaskPage> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: fulfillmentQueryKeys.list(filters),
    queryFn: () => apiClient.fulfillment.list(filters),
  });
}
