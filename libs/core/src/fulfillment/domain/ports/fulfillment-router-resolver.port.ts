/**
 * Fulfilment router resolution — the ONE seam (#2396 `W3a-7`, wired by #2408)
 *
 * *"Is there a fulfilment router for this connection, and if so, which?"*
 *
 * ## Why this is a port and not a function
 *
 * #2395's `FulfillmentWorkRouteHandler` carried this as a private stub, and
 * #2396's ingestion intercept needs the identical answer. Two copies would be a
 * latent **double shipment**: with the first real router wired and only one site
 * edited, the handler routes an order to a holder while the intercept — still
 * seeing `null` — mirrors that same order into a destination shop. Both halves
 * ship green, and the defect surfaces as two parcels.
 *
 * So there is exactly one implementation, and both call sites take it through
 * this port. It replaced a dependency-free module function at #2408, for the
 * plain reason that the answer stopped being free: building the router needs an
 * inventory read, a location read, a work read and the operator's ruleset, and a
 * module function can obtain none of them — while `libs/core/src/orders` may not
 * import `@openlinker/oms`, where the implementation has to live.
 *
 * ## The binding is REQUIRED, and that is the safety property
 *
 * Injection is deliberately **not** `@Optional()`. An optional token defaulting
 * to `null` makes a host that FORGOT the binding indistinguishable from one
 * deliberately running router-less — and since a router-less install is a silent,
 * fully-specified pass-through, that misconfiguration would never surface: lint,
 * type-check and every unit test pass while the feature does nothing.
 *
 * A host that omits the binding therefore fails to boot, and "no router" is an
 * explicit value (`NullFulfillmentRouterResolver`) rather than an absent
 * provider. Same posture as `assertFullLaneCoverage` (ADR-050): an uncovered case
 * is a loud boot failure, never a row silently stranded.
 *
 * ## Deliberately NOT `getCapabilityAdapter(connectionId, 'FulfillmentRouter')`
 *
 * That name is absent from `CoreCapabilityValues` and from every manifest **by
 * design** (#2393/#2403 — authority A2 is `config-only`), and a live spec asserts
 * the absence. Calling it would fail the manifest gate on every installation.
 * Adding the name would reintroduce the #2085 trap: `enabledCapabilities` is
 * stamped at connection create and never retro-filled, so gating on a new name
 * drains nothing for every connection that already exists.
 *
 * ## `null` is a specified answer, not unfinished work
 *
 * ADR-054: *"with no router configured the layer is a degenerate pass-through:
 * no work objects, today's path byte-identical — the property that survives the
 * Wave-5 kill."* An implementation returning `null` is that install, and it is
 * pinned by characterisation tests in `order-ingestion.service.spec.ts`.
 *
 * @module libs/core/src/fulfillment/domain/ports
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { FulfillmentRouterPort } from './fulfillment-router.port';

export interface FulfillmentRouterResolverPort {
  /**
   * The router for the connection that holds authority A2, or `null` when that
   * connection has no router — which is every installation that has not adopted
   * OMS routing.
   *
   * Never throws for an ordinary "no router" answer. An implementation that
   * cannot read the connection degrades to `null` (the safe direction: an
   * unrouted order is recoverable by hand, two shipments are not) and is
   * expected to say so at `warn`, because a silent degrade here is a feature
   * that quietly does nothing.
   *
   * @param connectionId the A2 holder chosen by `selectPrimaryFulfillmentRouter`.
   */
  resolve(connectionId: string): Promise<FulfillmentRouterPort | null>;
}
