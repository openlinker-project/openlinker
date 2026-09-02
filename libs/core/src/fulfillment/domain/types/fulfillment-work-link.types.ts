/**
 * Work→Shipment Link Resolution (#2402, `W3a-13`)
 *
 * The answer to *"which `FulfillmentWork` does this order's shipment satisfy?"*,
 * shaped so the caller cannot collapse the three real answers into two.
 *
 * ## Why multiplicity is a NAMED outcome and not a `null`
 *
 * A split order legitimately has N works — that is ADR-054's whole point, not an
 * edge case. So `findByOrderId` returning two rows is normal operation, and a
 * `string | null` return would force the caller to spell "more than one" as
 * `null`, i.e. as "no work", which is a different and false statement.
 *
 * Attributing ONE whole-order observed shipment across N works is **line-grain
 * attribution**, which OpenLinker does not have: it is the `shipment_lines`
 * concern (#2727), keyed `(shipmentId, orderId, lineId, quantity)` and carrying
 * its own backfill and rollup obligations. Until that exists, `ambiguous` is the
 * honest answer and the linkage is deliberately left unwritten — an unset link
 * is recoverable, a wrongly-attributed one is not.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

export type FulfillmentWorkLinkResolution =
  /** Exactly one work covers the order — the only case that produces a link. */
  | { readonly kind: 'unique'; readonly workId: string }
  /** The order was never routed, or its work has been removed. Not an error. */
  | { readonly kind: 'none' }
  /**
   * Several works cover the order. Reported rather than guessed: picking one
   * would attribute a parcel to a work that may not have shipped it. Resolving
   * this needs line grain (#2727).
   */
  | { readonly kind: 'ambiguous'; readonly workIds: readonly string[] };
