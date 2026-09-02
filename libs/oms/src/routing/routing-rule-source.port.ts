/**
 * Routing Rule Source Port
 *
 * Where the router gets its ordered ruleset. A port rather than the repository
 * class directly, so the pure pipeline and the router can be exercised without
 * a database — and so #2407, which owns router reachability, can supply the
 * ruleset from whatever seam it wires.
 *
 * @module libs/oms/src/routing
 */
import type { RoutingRule } from './routing-rule.types';

export interface RoutingRuleSourcePort {
  /**
   * The rules live for `connectionId` at `now`, in evaluation order.
   *
   * An empty result is a legitimate, expected answer: it means the operator has
   * authored no ruleset, and the router treats it as "not configured" rather
   * than as an error.
   */
  listActiveRules(connectionId: string, now: Date): Promise<readonly RoutingRule[]>;
}
