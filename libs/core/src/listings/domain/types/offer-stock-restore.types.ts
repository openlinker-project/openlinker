/**
 * Offer Stock Restore Types
 *
 * Marketplace-neutral target for the order-cancellation stock-restore flow
 * (#1146). Core resolves the absolute master-inventory quantity per offer and
 * passes plain `{ externalOfferId, quantity }` targets to the destination
 * adapter — so the plugin contract never depends on a core inventory service,
 * and no id has to double as both a variant key and an offer id.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface OfferStockRestoreTarget {
  /** Marketplace-native offer id to set stock on. */
  externalOfferId: string;
  /** Absolute stock quantity to set (re-runnable by construction). */
  quantity: number;
  /**
   * Stable per (order, offer, quantity, observation): the same restore retried
   * unchanged carries the same key, while a retry after stock moved, or a
   * restore of the same offer for another order, carries a different one.
   * Optional so an adapter that needs no key (Erli) is unaffected; one whose
   * quantity write is command-keyed (Allegro) REQUIRES it and refuses a target
   * without one rather than inventing a key that defeats the dedupe.
   */
  idempotencyKey?: string;
}
