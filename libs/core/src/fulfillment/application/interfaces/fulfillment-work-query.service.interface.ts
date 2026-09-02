/**
 * Fulfillment Work Query Service Interface (#2402, `W3a-13`)
 *
 * The read seam a SIBLING context uses to ask what work covers an order.
 *
 * It exists because `FulfillmentWorkRepositoryPort` may not cross a context
 * boundary: `scripts/check-cross-context-imports.mjs` denies any `*RepositoryPort`
 * import between contexts, and the port is deliberately absent from this
 * context's barrel. `findByOrderId` already exists on that port, so this service
 * adds no persistence capability — it surfaces one, and applies the multiplicity
 * policy in exactly one place.
 *
 * ## The connection axis is deliberately absent from the signature
 *
 * The obvious-looking overload — "find the work for this order ON this
 * connection" — is a trap, and the reason is worth stating so it is not
 * helpfully added later. `FulfillmentWork` carries `assignedConnectionId`: the
 * **executor holder**. The shipping-side caller holds the **order-source / OMP
 * marketplace** connection whose status it just read. Those two coincide on an
 * `omp_fulfilled` topology and DIVERGE on a routed `ol_managed_carrier` one — so
 * a connection-filtered lookup would silently match nothing, leave every
 * shipment unlinked, and report no error at all, failing only on the topology
 * this programme exists to enable.
 *
 * Order identity is the axis both sides genuinely share.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type { FulfillmentWorkLinkResolution } from '../../domain/types/fulfillment-work-link.types';

export interface IFulfillmentWorkQueryService {
  /**
   * Resolve the work an order's shipment should link to.
   *
   * Never throws for a business condition — "none" and "ambiguous" are named
   * outcomes. Infrastructure faults still propagate.
   */
  resolveLinkForOrder(orderId: string): Promise<FulfillmentWorkLinkResolution>;

  /**
   * The connections excluded from re-sourcing this order because they rejected
   * it with a **blocking** reason (ADR-054: "blocking excludes the rejecter
   * from re-sourcing").
   *
   * Deliberately narrow (#2408). It returns connection ids and nothing else,
   * because that is all the `not-blocked-by-reject` routing filter needs, and a
   * general work query here would be mistaken for the worklist read model —
   * which **#2406** owns. The grain is the CONNECTION, not the location:
   * `FulfillmentWorkRejection` carries no location, and the rejecter is a
   * holder rather than a place.
   */
  listBlockingRejectionConnectionIds(orderId: string): Promise<readonly string[]>;
}
