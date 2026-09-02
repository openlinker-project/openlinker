/**
 * Fulfilment router resolution — the ONE seam (#2396, `W3a-7`)
 *
 * ## Why this file exists at all
 *
 * #2395's `FulfillmentWorkRouteHandler` carried this as a private stub, and
 * #2396's ingestion intercept needs the identical answer. Two copies would be a
 * latent **double shipment**: when #2408/#2409 wire the first real router and
 * only one site is edited, the handler routes an order to a holder while the
 * intercept — still seeing `null` — mirrors that same order into a destination
 * shop. Both halves ship green, and the defect surfaces as two parcels.
 *
 * So there is exactly one body, and it is this one. **#2408/#2409 replace THIS
 * function**; nothing else needs touching, and a second copy must never be
 * introduced.
 *
 * ## Deliberately NOT `getCapabilityAdapter(connectionId, 'FulfillmentRouter')`
 *
 * That name is absent from `CoreCapabilityValues` and from every manifest **by
 * design** (#2393/#2403 — A2 is `config-only`), and a live spec asserts the
 * absence. Calling it would fail the manifest gate on every installation.
 * Adding the name would reintroduce the #2085 trap: `enabledCapabilities` is
 * stamped at connection create and never retro-filled, so gating on a new name
 * drains nothing for every connection that already exists.
 *
 * ## The `null` answer is the specified behaviour, not unfinished work
 *
 * ADR-054: *"with no router configured the layer is a degenerate pass-through:
 * no work objects, today's path byte-identical — the property that survives the
 * Wave-5 kill."* Every installation today takes that path.
 *
 * @module libs/core/src/orders/application/services
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { FulfillmentRouterPort } from '@openlinker/core/fulfillment';

/**
 * The router for the selected connection, or `null` when none is wired.
 *
 * @param _connectionId the A2 holder chosen by `selectPrimaryFulfillmentRouter`
 */
export async function resolveFulfillmentRouter(
  _connectionId: string
): Promise<FulfillmentRouterPort | null> {
  return await Promise.resolve(null);
}
