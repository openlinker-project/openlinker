/**
 * Routing Decision Reaper Service — contract (#2731)
 *
 * Closes a routing decision left `live` after an in-doubt `route()` once it is
 * past the routing-decision TTL, and reports what the worker must do so the
 * order routes again.
 *
 * ## Why the decision is left live in the first place
 *
 * `RoutingCommitService.leaveInDoubt` (#2395) keeps it live on a timeout or a
 * throwing `route()`: the router may still be committing, and freeing the slot
 * early would let a second decision mint a second idempotency key. The decision
 * is resumed only when something routes the order again, so on its own it can
 * wait for ever, and the order with it.
 *
 * ## Why a reap is safe
 *
 * - The TTL floor sits above the longest `route()` budget any configuration
 *   allows (asserted in `routing-decision-ttl.types.spec.ts`).
 * - The reap is the unchanged `terminalise`, whose `WHERE state = 'live'` is the
 *   same guard a late commit takes. A commit that loses throws
 *   `RoutingDecisionNoLongerLiveError` and rolls its work rows back, so a late
 *   answer and the reaper cannot both win.
 *
 * Nothing here asks the router whether it committed: the port has no such read
 * and D4 rules one out. For the in-process OL router a late answer cannot commit
 * at all; for a future out-of-tree router the TTL is the only protection.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type {
  GetRoutingDecisionStatusInput,
  ReapStrandedDecisionsInput,
  ReapStrandedDecisionsResult,
  RoutingDecisionStatusView,
} from '../types/routing-decision-reaper.types';

export interface IRoutingDecisionReaperService {
  /**
   * Examine one bounded page of stranded decisions and reap what is still live.
   *
   * Frontier-as-query, never a scan offset: a reaped decision leaves the
   * candidate set. Per-candidate failures are counted and the page continues;
   * only a failure of the frontier read itself propagates.
   */
  reapStranded(input: ReapStrandedDecisionsInput): Promise<ReapStrandedDecisionsResult>;

  /**
   * The order's latest routing decision as a read-only view, or `null` when the
   * order was never routed. Reads only; never terminalises anything.
   */
  getStatusForOrder(input: GetRoutingDecisionStatusInput): Promise<RoutingDecisionStatusView | null>;
}
