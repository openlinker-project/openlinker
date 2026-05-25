/**
 * Fulfillment Routing Service Interface
 *
 * Application contract for the general fulfillment-routing model (#832): read
 * + replace connection-scoped routing rules (with capability/topology
 * compatibility validation on write), and resolve a routing decision for an
 * order. See ADR-012 for the model and branch-1 decision.
 *
 * @module libs/core/src/mappings/application/interfaces
 */

import type { FulfillmentRoutingRule } from '../../domain/entities/fulfillment-routing-rule.entity';
import type {
  FulfillmentRoutingQuery,
  FulfillmentRoutingResolution,
  FulfillmentRoutingRuleInput,
} from '../../domain/types/fulfillment-routing.types';

export interface IFulfillmentRoutingService {
  /** All routing rules scoped to a source connection. */
  getRules(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]>;

  /**
   * Replace all routing rules for a source connection. Each rule's processor
   * is validated for capability + topology compatibility before persisting;
   * an incompatible rule throws `IncompatibleProcessorException` and no rules
   * are written.
   */
  replaceRules(
    sourceConnectionId: string,
    items: FulfillmentRoutingRuleInput[],
  ): Promise<FulfillmentRoutingRule[]>;

  /**
   * Resolve the routing decision for an order's `(source, method)`. Falls back
   * to the `omp_fulfilled` default (today's PrestaShop-fulfilled behaviour)
   * when no rule matches or the order carries no delivery method.
   */
  resolve(query: FulfillmentRoutingQuery): Promise<FulfillmentRoutingResolution>;
}
