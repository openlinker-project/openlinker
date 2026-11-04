/**
 * Shopify Order Feed Cursor Mapper
 *
 * The order feed's opaque cursor, `v1|{updatedAt ISO}|{numeric order id}` -
 * the `(updatedAt, id)` keyset of the last order handed to core. Versioned so
 * a later shape can be told apart; a value this adapter did not write is
 * refused (`RangeError`, non-retryable) rather than read as "start over",
 * which would re-ingest the whole order history.
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { ShopifyOrderFeedCursor } from '../../domain/types/shopify-order-feed.types';

const VERSION = 'v1';
const ORDER_ID = /^\d+$/;

export const EMPTY_SHOPIFY_FEED_CURSOR: ShopifyOrderFeedCursor = { updatedAt: null, orderId: null };

export function parseShopifyFeedCursor(
  raw: string | null | undefined,
  connectionId: string,
): ShopifyOrderFeedCursor {
  if (raw === null || raw === undefined) {
    return EMPTY_SHOPIFY_FEED_CURSOR;
  }
  const parts = raw.trim().split('|');
  const [version, updatedAt, orderId] = parts;
  if (
    parts.length !== 3 ||
    version !== VERSION ||
    Number.isNaN(Date.parse(updatedAt ?? '')) ||
    !ORDER_ID.test(orderId ?? '')
  ) {
    throw new RangeError(
      `Shopify order feed cursor is not one this adapter wrote, got "${raw}" (connection: ${connectionId})`,
    );
  }
  return { updatedAt: new Date(updatedAt).toISOString(), orderId };
}

export function formatShopifyFeedCursor(cursor: ShopifyOrderFeedCursor): string | null {
  if (cursor.updatedAt === null || cursor.orderId === null) {
    return null;
  }
  return [VERSION, cursor.updatedAt, cursor.orderId].join('|');
}

/** Strict keyset order: true when `(updatedAt, id)` comes after the cursor. */
export function isAfterShopifyCursor(
  cursor: ShopifyOrderFeedCursor,
  updatedAtIso: string,
  orderId: string,
): boolean {
  if (cursor.updatedAt === null || cursor.orderId === null) {
    return true;
  }
  const a = Date.parse(updatedAtIso);
  const b = Date.parse(cursor.updatedAt);
  if (a !== b) {
    return a > b;
  }
  return BigInt(orderId) > BigInt(cursor.orderId);
}
