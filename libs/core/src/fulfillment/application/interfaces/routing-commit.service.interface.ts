/**
 * Routing Commit Service Interface (#2395, `W3a-6`)
 *
 * ## Not `IFulfillmentRoutingService` — that name is TAKEN
 *
 * `libs/core/src/mappings` already exports `IFulfillmentRoutingService`
 * (#832, ADR-012), bound to `FULFILLMENT_ROUTING_SERVICE_TOKEN` and consumed in
 * `shipping`. It answers *"which processor or carrier DISPATCHES this?"*; this
 * one answers *"which location and holder SOURCES it?"*.
 * `fulfillment-router.port.ts` already warns that the two questions are close
 * and must never be wired into one another, so the names are kept apart too.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type { RouteOrderInput, RoutingCommitOutcome } from '../types/routing-commit.types';

export interface IRoutingCommitService {
  /**
   * Decide where an order is fulfilled from, exactly once, and commit it.
   *
   * Never throws for an ordinary refusal — every outcome, including a router
   * that failed, is a member of {@link RoutingCommitOutcome}. A throw here means
   * persistence itself failed.
   */
  route(input: RouteOrderInput): Promise<RoutingCommitOutcome>;
}
