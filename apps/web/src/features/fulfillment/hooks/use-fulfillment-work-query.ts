/**
 * One fulfilment task by id (#3097)
 *
 * The read behind the task detail page. `apiClient.fulfillment.get(workId)`
 * has existed and been schema-parsed since #2411 with no caller anywhere
 * (dead code, confirmed by #3029); this hook is what makes it reachable. The
 * client method and its boundary schema are unchanged.
 *
 * ## The key sits under `fulfillmentQueryKeys.all`, and that IS the mechanism
 *
 * `useFulfillmentTaskActionMutation` invalidates `all` on success and on any
 * 409, and `all` is `['fulfillment']`. A `detail` key under that prefix is
 * therefore refreshed by an action taken on any fulfilment surface, which is
 * the whole of "an action applied on either surface refreshes the detail
 * read". Nothing here subscribes to the mutation and nothing needs to; the
 * prefix does the work. A key outside it would leave this page rendering a
 * task the operator has already changed.
 *
 * ## A 404 is surfaced, never mapped to `null`
 *
 * `workId` comes from the URL bar, so a 404 means the ADDRESS is wrong. That
 * is a distinct state the detail page renders on its own, beside loading, a
 * transport failure and loaded, so the error reaches the caller as the
 * `ApiError` it was: `error instanceof ApiError && error.isNotFound()` is a
 * not-found, and `error.isNetworkError()` (status 0) is a transport failure.
 * Collapsing the 404 into `data: null` would take that branch away.
 *
 * This is deliberately the opposite of `useOrderInvoiceQuery`, which does map
 * its 404 to `null`. There the 404 means "no invoice exists yet" — a
 * legitimate domain state of an order the page has already resolved. Here
 * there is no resource and no domain state to report, only a bad address.
 *
 * ## No `retry` option, deliberately
 *
 * A 404 must not be retried: the first response settles a URL typo, so
 * retrying spends requests to learn the same thing. It needs no predicate
 * here because the app-wide default in `app/providers/app-providers.tsx` is
 * already `retry: false`, and restating that locally would give the rule a
 * second home to drift from. What a future reader must keep: anything that
 * ADDS retries here, for transport resilience say, has to exclude a 404
 * explicitly.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { FulfillmentTask } from '../api/fulfillment.types';

export function useFulfillmentWorkQuery(workId: string): UseQueryResult<FulfillmentTask> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: fulfillmentQueryKeys.detail(workId),
    queryFn: () => apiClient.fulfillment.get(workId),
    // An absent route param must sit disabled rather than request
    // `/fulfillment/works/undefined` and read the 404 back as a real answer.
    //
    // A disabled query rests at `status: 'pending', fetchStatus: 'idle'` for
    // ever, so a consumer branching on `isPending` first would render the
    // loading state and never leave it — the trap
    // `order-fulfillment-tasks-panel.tsx` already documents. Unreachable
    // through the route (React Router never matches a `:workId` segment to
    // an empty string), which is why the copy table ships no fifth state for
    // it; a caller that can pass an empty id owns that branch itself.
    enabled: Boolean(workId),
  });
}
