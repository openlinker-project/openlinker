/**
 * useOmsRoutingState (#3505)
 *
 * Whether fulfilment routing ("OMS") is switched on for this install, read off
 * the `sourcing` row of `GET /fulfillment-authority/status`. It wraps
 * {@link useWhoDecidesStatusQuery} — the same query and cache key as the
 * who-decides page and `useOmsAttentionQuery` — so it costs no extra request
 * and can never disagree with them.
 *
 * Routing is on exactly when something claims the sourcing authority: every
 * state except `default` (`nobody-to-route`) means a claim exists. It is NOT
 * read from `enabledCapabilities` — `FulfillmentRouter` is deliberately not a
 * registry capability — nor re-derived from connection config, which would be
 * a browser-side mirror of a rule that lives in core.
 *
 * ## Four states, because callers fail in different directions
 *
 * - `unknown` — the read has not answered yet (or is disabled). Nothing is
 *   known, so a caller that HIDES OMS chrome keeps it hidden.
 * - `unreadable` — the read failed, or answered without a readable sourcing
 *   row. A navigation entry must stay reachable then (a status outage must not
 *   take the screen away), while an order-detail panel that is only relevant
 *   with routing on can stay quiet.
 * - `off` / `on` — the settled answer.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { useWhoDecidesStatusQuery } from './use-who-decides-status-query';
import type { AuthorityStatus } from '../api/who-decides.types';
import type { OmsRoutingState } from './use-oms-routing-state.types';

export interface OmsRoutingStateInput {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data: AuthorityStatus | null | undefined;
}

/**
 * The derivation, as a pure function so it can be asserted without a query.
 *
 * `isError` is tested before `isPending`: a failed read is never "still
 * loading", and reporting it as `unknown` would hide a navigation entry for as
 * long as the status endpoint is down.
 */
export function deriveOmsRoutingState({
  isPending,
  isError,
  data,
}: OmsRoutingStateInput): OmsRoutingState {
  if (isError) return 'unreadable';
  if (isPending) return 'unknown';
  const sourcingRow = data?.rows.find((row) => row.question === 'sourcing');
  if (sourcingRow === undefined) return 'unreadable';
  return sourcingRow.state === 'default' ? 'off' : 'on';
}

export interface UseOmsRoutingStateOptions {
  /**
   * `false` skips the read entirely (the state stays `unknown`). For a caller
   * whose session could not use the answer — a packer's shell has no
   * routing-gated entry it could see — so it does not issue a request the API
   * refuses.
   */
  readonly enabled?: boolean;
}

export function useOmsRoutingState(options: UseOmsRoutingStateOptions = {}): OmsRoutingState {
  const query = useWhoDecidesStatusQuery({ enabled: options.enabled ?? true });
  return deriveOmsRoutingState({
    isPending: query.isPending,
    isError: query.isError,
    data: query.data,
  });
}
