/**
 * Fulfilment-task query keys (#2411, list axis added by #2410)
 *
 * Every key is prefixed `['fulfillment', …]`, which is what makes `all` a valid
 * invalidation ancestor of all of them — the action mutation invalidates `all`
 * precisely so an action taken on one surface refreshes the other (#2411).
 *
 * @module apps/web/src/features/fulfillment/api
 */
import type { FulfillmentTaskFilters } from './fulfillment.types';

export const fulfillmentQueryKeys = {
  all: ['fulfillment'] as const,
  worksByOrder: (orderId: string) => ['fulfillment', 'works', 'by-order', orderId] as const,
  /**
   * The worklist's rows. The filter object is part of the key, so changing a
   * filter is a different query rather than a refetch of the same one.
   */
  list: (filters: FulfillmentTaskFilters) => ['fulfillment', 'works', 'list', filters] as const,
};
