/**
 * Shopify Throttle Policy
 *
 * Shopify meters Admin GraphQL by query COST against a leaky bucket per app
 * and store, reported on every answer as `extensions.cost.throttleStatus`
 * (`maximumAvailable`, `currentlyAvailable`, `restoreRate`). The budget
 * differs per plan (20000 / 1000 per s on the spike's dev store, L-C2), so it
 * is read, never assumed. These pure functions turn the last observation into
 * a wait, so the client slows down BEFORE Shopify answers `THROTTLED`.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import type { ShopifyThrottleStatus } from '../types/shopify-api.types';

export interface ShopifyThrottleObservation {
  readonly status: ShopifyThrottleStatus;
  /** Cost of the query that produced the observation, used as the next query's estimate. */
  readonly lastQueryCost: number;
  readonly observedAtMs: number;
}

/** Extra wait so a refill computed to the millisecond is not one point short. */
const REFILL_SLACK_MS = 250;

/** Points the bucket holds at `nowMs`, refilled since the observation and capped at the maximum. */
export function estimateAvailablePoints(observation: ShopifyThrottleObservation, nowMs: number): number {
  const { status } = observation;
  const elapsedSeconds = Math.max(0, nowMs - observation.observedAtMs) / 1000;
  return Math.min(status.maximumAvailable, status.currentlyAvailable + status.restoreRate * elapsedSeconds);
}

/**
 * Milliseconds to wait until the bucket holds `cost` points, or 0 when it
 * already does. A restore rate of 0 (never reported in practice) gives 0
 * rather than an infinite wait: Shopify's own `THROTTLED` answer is the
 * backstop.
 */
export function throttleWaitMs(
  observation: ShopifyThrottleObservation,
  cost: number,
  nowMs: number,
): number {
  const missing = cost - estimateAvailablePoints(observation, nowMs);
  if (missing <= 0 || observation.status.restoreRate <= 0) {
    return 0;
  }
  return Math.ceil((missing / observation.status.restoreRate) * 1000) + REFILL_SLACK_MS;
}
