/**
 * Fulfillment — public barrel (#2391)
 *
 * The `FulfillmentWork` vocabulary: the unit of fulfilment assignment, and the
 * two orthogonal state axes it carries.
 *
 * **Leaf posture.** This context follows ADR-053's types-and-pure-functions
 * shape, the same as `sales-documents` (#2100), `fulfillment-authority` (#2304)
 * and `order-lifecycle` (#2305). It ships a `fulfillment.tokens.ts` from day
 * one — unlike the other two — because its first DI binding is already named
 * (#2392); see that file.
 *
 * **The load-bearing property is ZERO SIBLING-CONTEXT VALUE EDGES, not
 * framework-freedom.** Framework-freedom ends the day this context gains a
 * module (#2392, ADR-053 says so explicitly). What must not lapse is that
 * nothing here creates a runtime edge to a sibling core context, which is what
 * keeps a consumer's value-import CJS-cycle-safe;
 * `libs/core/src/__tests__/barrel-purity.spec.ts` enforces it per leaf.
 *
 * **The one authorized cross-context import** is `FulfillmentCancellationReason`
 * from `@openlinker/core/fulfillment-authority`, **type-only** and therefore
 * erased at build time. See `fulfillment-work.types.ts` for the two conditions
 * that make it safe.
 *
 * **ADR-053's no-injection invariant, binding on everything under this
 * directory**: the `fulfillment` context injects **no** `orders` / `inventory`
 * service. Order data enters as ARGUMENTS (which is why `FulfillmentWork.orderId`
 * is a plain string); a type need goes through `@openlinker/core/orders/types`, which that guard permits by exact-specifier match. Note it is deliberately NOT in this leaf's `ZERO_SIBLING_EDGE_LEAVES` allow-set, so taking that route additionally requires a one-line registration there — per-leaf and deliberate, never a free ride.
 * Enforced as a prohibition by `scripts/check-no-injection-contracts.mjs`, whose
 * source-text scan cannot see `ModuleRef.get(TOKEN, { strict: false })` — the
 * complement is `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts`.
 *
 * | Published | What it answers |
 * |---|---|
 * | `FulfillmentWorkStatus` | how far the physical work has got (execution axis) |
 * | `FulfillmentRequestStatus` | what has been asked of a holder, and their answer (negotiation axis) |
 * | `FulfillmentWorkAction` | the closed set of things that can be done to a work object |
 * | `FulfillmentWork` / `FulfillmentWorkLine` / `FulfillmentWorkRef` | the aggregate, its counter-bearing lines, and the ref an executor is handed |
 * | `FulfillmentRouterPort` | how a router is asked where an order is sourced from |
 * | `RoutingInput` / `RoutingShipTo` | what a router is told — an explicit PII allowlist projection (ADR-062) |
 * | `RoutingPlan` / `RoutingEvaluation` | the committing answer, and the non-committing one |
 *
 * ## What consumes this
 *
 * Nothing yet — the vocabulary ships first so the contexts that adopt it adopt
 * one spelling (the #2304 posture). #2392 persists it, #2395 creates it in one
 * transaction with the routing decision, #2398/#2399 carry it across the
 * executor port, #2406 projects it with `supportedActions`.
 *
 * @module libs/core/src/fulfillment
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */
export * from './domain/types/fulfillment-work-status.types';
export * from './domain/types/fulfillment-request-status.types';
export * from './domain/types/fulfillment-work-action.types';
export * from './domain/types/fulfillment-work.types';
export * from './domain/types/routing-ship-to.types';
export * from './domain/types/routing.types';

export * from './domain/ports/fulfillment-router.port';

export * from './domain/exceptions/pending-routing-plan-not-supported.error';

export * from './fulfillment.tokens';
