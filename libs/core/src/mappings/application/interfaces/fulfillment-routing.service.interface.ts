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
  CandidateProcessor,
  FulfillmentRoutingQuery,
  FulfillmentRoutingResolution,
  FulfillmentRoutingRuleInput,
} from '../../domain/types/fulfillment-routing.types';

export interface IFulfillmentRoutingService {
  /** All routing rules scoped to a source connection. */
  getRules(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]>;

  /**
   * The processors a source connection's delivery methods may be routed to,
   * for the routing-config UI (#836). Enumerates active connections and keeps
   * those compatible per the same predicate `replaceRules` validates against,
   * so the UI never offers an option the write path would reject. Metadata-only
   * (no adapter instantiation).
   */
  getCandidateProcessors(sourceConnectionId: string): Promise<CandidateProcessor[]>;

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

  /**
   * Batched counterpart to {@link resolve} (#1791): resolves many orders'
   * `(source, method)` pairs in one pass — one repository read per distinct
   * `sourceConnectionId` rather than one per order — so a page of orders can
   * carry a `deliveryResolution` projection without an N+1. Returns
   * resolutions positionally aligned with `queries`.
   */
  resolveBatch(queries: FulfillmentRoutingQuery[]): Promise<FulfillmentRoutingResolution[]>;
}
