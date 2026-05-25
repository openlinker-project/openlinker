/**
 * Fulfillment Routing Repository Port
 *
 * Persistence contract for `FulfillmentRoutingRule`. Mirrors
 * `CarrierMappingRepositoryPort`'s connection-scoped replace semantics, plus
 * a single-rule lookup used by resolution.
 *
 * Implemented by the infrastructure layer.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { FulfillmentRoutingRule } from '../entities/fulfillment-routing-rule.entity';
import type { FulfillmentRoutingRuleInput } from '../types/fulfillment-routing.types';

export interface FulfillmentRoutingRepositoryPort {
  /** All rules scoped to a source connection. */
  findBySourceConnectionId(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]>;

  /**
   * The rule for a `(sourceConnectionId, sourceDeliveryMethodId)` pair, or
   * null if none is configured.
   */
  findRule(
    sourceConnectionId: string,
    sourceDeliveryMethodId: string
  ): Promise<FulfillmentRoutingRule | null>;

  /**
   * Replace all rules for a source connection atomically (delete + insert in
   * a transaction). Mirrors `CarrierMappingRepositoryPort.replaceForConnection`.
   */
  replaceForConnection(
    sourceConnectionId: string,
    items: FulfillmentRoutingRuleInput[]
  ): Promise<FulfillmentRoutingRule[]>;
}
