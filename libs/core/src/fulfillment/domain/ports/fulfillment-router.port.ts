/**
 * Fulfillment Router Port (#2393, DESIGN §5.3)
 *
 * The contract a fulfilment router is called through: given an order's lines and
 * an allowlisted ship-to projection, decide where the work is sourced from.
 *
 * ## NOT the same thing as `mappings`' `FulfillmentRouting*` family
 *
 * `libs/core/src/mappings` already ships an HTTP-exposed routing stack —
 * `FulfillmentRoutingQuery`, `IFulfillmentRoutingService`,
 * `connections/:connectionId/routing-rules` — and `ReservationService` consumes
 * it. That one answers **"which processor or carrier DISPATCHES this?"**; this
 * port answers **"which location and holder SOURCES this?"**. The names are
 * close and the questions are not, so do not wire one into the other and do not
 * rename either.
 *
 * ## Three properties of the contract
 *
 * **(a) The return type can say no.** `RoutingPlan.unfulfillable` resolves lines
 * as line-scoped refund or return — never a partial-cancel state no source can
 * express (ADR-054: OpenLinker cannot split a commercial order, so the WORK is
 * split and the order is left alone).
 *
 * **(b) `evaluate()` is non-committing, and that is a CONTRACT-level property.**
 * It is not a runtime guarantee about a plugin's behaviour: a third-party
 * router's `evaluate()` can do whatever it likes inside itself and core cannot
 * forbid it. What the contract does guarantee is that **no committing identifier
 * can travel in either direction** on this path — `RoutingEvaluation` carries no
 * `decisionId`, so no caller can persist a decision off an evaluate result, and
 * `evaluate` takes no `RouteOptions`, so it cannot even be handed an idempotency
 * key. ADR-044 records that nothing else planned produces a dry run; this is
 * what closes it.
 *
 * **(c) Rules are opaque here.** The closed named filters and sorts, and their
 * coercer, belong to `@openlinker/oms` (REVIEW H7) — they configure
 * OpenLinker's own router and bind no vendor. Core carries only
 * `RoutingRuleRef`, so a vendor's own rule names render in the explanation an
 * operator reads.
 *
 * ## Not a registry capability
 *
 * `FulfillmentRouter` is deliberately absent from `CoreCapabilityValues` and
 * from every adapter manifest (#2403 — A2 `sourcing` is `config-only`). Nothing
 * can dispatch the name, and advertising it would invite a gate on
 * `enabledCapabilities`, which is stamped at connection create and never
 * retro-filled — so the gate would silently drain nothing for every connection
 * that already exists (the #2085 shape). Do not add it. If discovery is ever
 * needed, narrow with a co-located `is*` guard (the `ModifiedProductLister`
 * precedent).
 *
 * ## Deferred, with owners
 *
 * Per-method error unions, wall-clock budgets, a declared `maxBatchSize` with
 * OL-side chunking, and an order-version/freshness token on `RoutingInput` are
 * Wave-4 hardening (`W4-1`, `W4-2`). The `pending` arm of `RoutingPlan` is
 * declared here and refused by `assertRoutingPlanResolved`; consuming it is
 * `W4-3`.
 *
 * @module libs/core/src/fulfillment/domain/ports
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.3
 * @see docs/architecture/adrs/062-trust-posture-authority-holding-capabilities.md
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type {
  RouteOptions,
  RoutingEvaluation,
  RoutingInput,
  RoutingPlan,
} from '../types/routing.types';

export interface FulfillmentRouterPort {
  /**
   * Answer the routing question without deciding it.
   *
   * Mints no internal id and operates on an ingested order only. Takes no
   * options, which is what makes "cannot be handed a committing key" structural
   * rather than a convention.
   */
  evaluate(input: RoutingInput): Promise<RoutingEvaluation>;

  /**
   * Decide, and answer with the plan the caller will create work from.
   *
   * `options.idempotencyKey` is REQUIRED and is derived from the routing-decision
   * row the caller persists before this call (#2395) — design §5.3's
   * persist-intent-before-the-boundary ordering, which a lock alone cannot supply.
   */
  route(input: RoutingInput, options: RouteOptions): Promise<RoutingPlan>;
}
