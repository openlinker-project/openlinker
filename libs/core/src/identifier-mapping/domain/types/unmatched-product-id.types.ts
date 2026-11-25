/**
 * Unmatched Product Id
 *
 * The synthetic `productId` carried by an order line that was accepted WITHOUT a
 * catalogue match (#4280, `catalogueMode: 'none'`). `order_line_items.productId`
 * is `NOT NULL` and the unified `Order` line type requires one, so an unmatched
 * line carries a deterministic placeholder instead of a real internal product id:
 *
 *   `unmatched:<connectionId>:<externalOfferId>`
 *
 * Deterministic on purpose: re-ingesting the same order produces the same id, and
 * analytics that group by `productId` therefore group per offer for free.
 *
 * It is NOT an internal product id. Every consumer that looks a product up by id
 * (reservations, tax-rate catalogue reads, invoice and fiscal commands, post-sale
 * stock refresh) must ask {@link isUnmatchedProductId} first and skip the line,
 * which is why the test lives here, once, rather than as a string prefix check
 * copied into each consumer.
 *
 * Pure helpers (no I/O).
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */

/** Literal prefix of every synthetic id. Exported for the analytics SQL only. */
export const UNMATCHED_PRODUCT_ID_PREFIX = 'unmatched:';

/**
 * Build the synthetic id for a marketplace line.
 *
 * `connectionId` is part of the id because an external offer id is only unique
 * within one marketplace account; two Allegro accounts can legitimately hold the
 * same offer id.
 */
export function buildUnmatchedProductId(connectionId: string, externalOfferId: string): string {
  return `${UNMATCHED_PRODUCT_ID_PREFIX}${connectionId}:${externalOfferId}`;
}

/**
 * Report whether a `productId` is the synthetic id of an unmatched line.
 *
 * Tolerates `null`/`undefined`/empty so a caller can pass an optional field
 * straight through; those are "not unmatched" (they are simply absent).
 */
export function isUnmatchedProductId(productId: string | null | undefined): boolean {
  return typeof productId === 'string' && productId.startsWith(UNMATCHED_PRODUCT_ID_PREFIX);
}

/**
 * Recover the external offer id from a synthetic id, or `null` when the value is
 * not one. The offer id is everything after the SECOND colon, because an external
 * id may itself contain colons.
 */
export function readUnmatchedOfferId(productId: string | null | undefined): string | null {
  if (!isUnmatchedProductId(productId)) {
    return null;
  }
  const rest = (productId as string).slice(UNMATCHED_PRODUCT_ID_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator < 0) {
    return null;
  }
  const offerId = rest.slice(separator + 1);
  return offerId.length > 0 ? offerId : null;
}

/**
 * A human-readable label for a `productId` that is shown when a line has no name
 * and no SKU: the marketplace offer id for a synthetic id (what the operator
 * recognises), the id itself otherwise. Keeps `unmatched:<connection>:` noise off
 * a document line.
 */
export function readableProductLabel(productId: string): string {
  return readUnmatchedOfferId(productId) ?? productId;
}
