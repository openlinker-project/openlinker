/**
 * Routing decision state (#3557)
 *
 * Which of the three operator-facing states an order's latest routing decision
 * is in. Pure, and deliberately small: `state` and `abandonReason` are server
 * vocabularies typed `string`, and only the literals below are compared.
 * Anything else resolves to `null` - nothing to say - never to a guess.
 *
 * Read only (D4): no state offers a control that forces, checks or abandons a
 * decision. `resolved` offers "Retry routing" and only while the order is held
 * in a state the retry endpoint accepts.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { RoutingDecisionStatus } from '../api/fulfillment.types';

export type RoutingDecisionViewState = 'stuck' | 'resolved' | 'healthy';

export function resolveRoutingDecisionState(
  decision: RoutingDecisionStatus | null | undefined
): RoutingDecisionViewState | null {
  if (!decision) return null;
  if (decision.state === 'live') {
    // Past its time limit and the reaper has not run yet. A live decision still
    // inside its limit is a normal wait and says nothing.
    return decision.strandedSince !== null ? 'stuck' : null;
  }
  if (decision.state === 'abandoned') {
    return decision.abandonReason === 'stranded-past-ttl' ? 'resolved' : null;
  }
  if (decision.state === 'committed') return 'healthy';
  return null;
}

/** The held states `POST /orders/:id/retry-routing` accepts (the sweep's set). */
const RETRYABLE_BLOCK_REASONS: readonly string[] = ['routing-refused', 'routing-failed'];

export function canRetryRouting(orderBlockReason: string | null | undefined): boolean {
  return typeof orderBlockReason === 'string' && RETRYABLE_BLOCK_REASONS.includes(orderBlockReason);
}
