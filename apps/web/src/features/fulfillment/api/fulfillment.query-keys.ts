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
  /**
   * One task by id, for the task detail page (#3097).
   *
   * The `['fulfillment', ...]` prefix is load-bearing here rather than merely
   * tidy: `useFulfillmentTaskActionMutation` invalidates `all` on success and
   * on any 409, and `all` is `['fulfillment']`. A `detail` key under that
   * prefix is therefore refreshed by an action taken on ANY fulfilment
   * surface — the detail page's own, and the assign board's. A key outside
   * the prefix would leave the detail page rendering a task the operator has
   * already changed.
   */
  detail: (workId: string) => ['fulfillment', 'works', 'detail', workId] as const,
  /**
   * The shipment(s) dispatched for one task (#3292). Sits under the same
   * `['fulfillment', ...]` prefix as `detail` above, for the same reason: an
   * action taken from any surface invalidates the whole feature, and a
   * dispatched-then-refreshed task should refresh its shipment panel too.
   */
  shipments: (workId: string) => ['fulfillment', 'works', 'shipments', workId] as const,
};
