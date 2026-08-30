/**
 * Routing Decision domain entity (#2394, ADR-054 R1, DESIGN §5.3)
 *
 * OpenLinker's own record that it is about to ask a router where an order is
 * fulfilled from — persisted BEFORE the committing `route()` call.
 *
 * Anemic and readonly per ADR-011: the row is mutated by exactly one narrow
 * conditional UPDATE in the repository, never by a method here.
 *
 * @module libs/core/src/fulfillment/domain/entities
 */
import type {
  RoutingDecisionAbandonReason,
  RoutingDecisionState,
} from '../types/routing-decision.types';

export class RoutingDecision {
  constructor(
    /** `ol_routingdecision_*`. OpenLinker's own id — NOT the router's. */
    public readonly id: string,
    /** By-value reference to the order. No FK — see the ORM entity. */
    public readonly orderId: string,
    /** The connection whose router is being asked. By-value; no FK. */
    public readonly routerConnectionId: string,
    public readonly state: RoutingDecisionState,
    /**
     * What the ROUTER called its own decision — `RoutingPlan.decisionId`
     * (#2393), recorded at terminalisation.
     *
     * Deliberately a separate field from `id`. That one is minted by OpenLinker
     * before `route()` is called and this one is minted by the vendor during
     * it, so they can never be the same value; conflating them would make the
     * audit trail read as though the vendor authored OpenLinker's intent.
     * `null` on a `committed` row is a real state and means the router answered
     * without naming a decision of its own.
     */
    public readonly routerDecisionRef: string | null,
    public readonly abandonReason: RoutingDecisionAbandonReason | null,
    public readonly terminalisedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
