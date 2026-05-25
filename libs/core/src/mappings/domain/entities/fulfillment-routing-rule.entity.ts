/**
 * Fulfillment Routing Rule Domain Entity
 *
 * A connection-scoped routing rule: for a given order source + source delivery
 * method, which fulfillment processor handles the shipment. Generalizes
 * `CarrierMapping` (#832, epic #732).
 *
 * Stores only the routing decision — `processorKind` + `processorConnectionId`.
 * The OMP destination is derived and the branch-1 destination carrier is
 * sourced from the co-keyed `CarrierMapping`; neither is a column here (ADR-012).
 *
 * Anemic per ADR-011 — readonly fields, no behaviour. `processorKind` is a
 * stored operator choice (ADR-012), not derived.
 *
 * @module libs/core/src/mappings/domain/entities
 */

import type { FulfillmentProcessorKind } from '../types/fulfillment-routing.types';

export class FulfillmentRoutingRule {
  constructor(
    public readonly id: string,
    public readonly sourceConnectionId: string,
    public readonly sourceDeliveryMethodId: string,
    public readonly processorKind: FulfillmentProcessorKind,
    public readonly processorConnectionId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
