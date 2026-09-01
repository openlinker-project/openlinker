/**
 * Routing Facts
 *
 * Everything the pipeline needs to decide, loaded by the caller and handed in.
 * The evaluator performs no I/O — the `evaluateSalesDocumentRules` precedent
 * (#2170), and the reason `evaluate()` and `route()` can share one code path
 * and be proven to explain identically.
 *
 * @module libs/oms/src/routing
 */

/** A location the router may source from, with the facts the filters read. */
export interface RoutingCandidate {
  readonly locationId: string;
  /**
   * The holder that would fulfil at this location, or `null` for an
   * operator-owned location with no holding connection. Never derived from
   * `InventoryLocation.ownerConnectionId`, whose docblock records it as
   * provenance and explicitly not authority.
   */
  readonly connectionId: string | null;
  /** Where the location IS. See `country-served` for why that is the weaker claim. */
  readonly countryIso2: string | null;
  readonly postcode: string | null;
}

/** Composite key for a per-location, per-variant stock reading. */
export function stockKey(locationId: string, productVariantId: string): string {
  return `${locationId}::${productVariantId}`;
}

export interface RoutingFacts {
  readonly candidates: readonly RoutingCandidate[];
  /** Available quantity, keyed by {@link stockKey}. A missing key means zero. */
  readonly stock: ReadonlyMap<string, number>;
  /**
   * Connections excluded from re-sourcing because they rejected this order with
   * a blocking reason (ADR-054). Connection-scoped because the rejecter IS a
   * holder — `FulfillmentWorkRejection` carries no location.
   */
  readonly blockedConnectionIds: ReadonlySet<string>;
}
