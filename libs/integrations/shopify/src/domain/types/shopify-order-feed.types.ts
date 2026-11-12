/**
 * Shopify Order Feed Cursor Types
 *
 * The decoded form of the opaque order-feed cursor: the `(updatedAt, id)`
 * keyset of the last order the feed handed to core. Ties on `updatedAt` are
 * broken by the numeric order id, so no order sharing a timestamp with the
 * watermark is skipped or repeated.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyOrderFeedCursor {
  /** ISO-8601 `updatedAt` of the last emitted order; null at the very start. */
  readonly updatedAt: string | null;
  /** Numeric id of the last emitted order, the tie-breaker within `updatedAt`. */
  readonly orderId: string | null;
}
