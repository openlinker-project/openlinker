/**
 * Pack-bench query keys (#2416, `W3b-3`)
 *
 * `all` is a valid invalidation ancestor of every key below, which is what the
 * expedite mutation invalidates so the list re-sorts immediately rather than at
 * the next poll.
 *
 * The work key carries NO filter object, unlike `fulfillmentQueryKeys.list`:
 * the read takes no parameters (the scope is the bench's, not the request's), so
 * there is exactly one entry and every consumer shares it.
 *
 * @module apps/web/src/features/bench/api
 */
export const benchQueryKeys = {
  all: ['bench'] as const,
  work: () => ['bench', 'work'] as const,
};
