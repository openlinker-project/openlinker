/**
 * Shopify Return Feed Cursor Mapper
 *
 * The return feed's opaque cursor, `rv2|{lap start ISO}|{order id or -}`: an
 * order-id keyset over the orders that carry a return, walked in LAPS from the
 * NEWEST order down. When a lap reaches the oldest such order the feed hands
 * out a fresh lap start with no order id, so the next poll starts again from
 * the newest.
 *
 * Newest first because the set only grows: an order keeps its `returned`
 * status for good, so on an ascending walk a new return waited behind the
 * shop's whole return history. A new return is almost always on a recent
 * order, so walking down finds it on the first page of the next lap.
 *
 * Laps exist because a return does not bump the order's `updatedAt`: a keyset
 * that only moved forward would never see a return opened on an order it had
 * already passed. Re-walking costs one search page per poll and no duplicate
 * work, since core dedupes each return id permanently. The lap start changes
 * the cursor value, which is what lets core commit an empty end-of-lap page.
 *
 * An `rv1` cursor (written by the ascending walk) starts a fresh lap: its order
 * id points the other way, and re-walking costs nothing since core dedupes
 * each return. Any other value this adapter did not write is refused
 * (`RangeError`, non-retryable) rather than read as "start over".
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { ShopifyReturnFeedCursor } from '../../domain/types/shopify-return.types';

const VERSION = 'rv2';
/** The ascending walk's cursor; read as "start a new lap". */
const LEGACY_VERSION = 'rv1';
const ORDER_ID = /^\d+$/;
const NO_ORDER = '-';

export function parseShopifyReturnFeedCursor(
  raw: string | null | undefined,
  connectionId: string,
  now: Date,
): ShopifyReturnFeedCursor {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { lapStartedAt: now.toISOString(), belowOrderId: null };
  }
  const parts = raw.trim().split('|');
  const [version, lapStartedAt, orderId] = parts;
  if (version === LEGACY_VERSION && parts.length === 3) {
    return { lapStartedAt: now.toISOString(), belowOrderId: null };
  }
  if (
    parts.length !== 3 ||
    version !== VERSION ||
    Number.isNaN(Date.parse(lapStartedAt ?? '')) ||
    (orderId !== NO_ORDER && !ORDER_ID.test(orderId ?? ''))
  ) {
    throw new RangeError(
      `Shopify return feed cursor is not one this adapter wrote, got "${raw}" (connection: ${connectionId})`,
    );
  }
  return {
    lapStartedAt: new Date(lapStartedAt).toISOString(),
    belowOrderId: orderId === NO_ORDER ? null : orderId,
  };
}

export function formatShopifyReturnFeedCursor(cursor: ShopifyReturnFeedCursor): string {
  return [VERSION, cursor.lapStartedAt, cursor.belowOrderId ?? NO_ORDER].join('|');
}
