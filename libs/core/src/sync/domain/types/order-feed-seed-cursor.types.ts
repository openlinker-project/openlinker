/**
 * Order Feed Seed Cursor Key
 *
 * A first order poll on a connection with no order cursor seeds the cursor at
 * the source's current head instead of reading its whole history (#4228). The
 * fact that the seed happened is stored under a key derived from the order
 * cursor key.
 *
 * Deliberately a separate `connection_cursors` row holding an ISO-8601 instant,
 * never a suffix of the cursor value itself: the order cursor formats are
 * adapter-defined and some (PrestaShop's keyset cursor) reject an extra
 * segment, so a marker packed into the value would corrupt them. The same
 * reasoning gave `masterSweepCompletedAtCursorKey` its own key.
 *
 * Pure-rule exception (`docs/engineering-standards.md`): this function IS the
 * rule for deriving the marker key from a cursor key.
 *
 * @module domain/types
 */

export const ORDER_FEED_SEEDED_AT_SUFFIX = '.seededAt';

/** `{cursorKey}.seededAt` - ISO instant at which the order cursor was seeded. */
export function orderFeedSeededAtCursorKey(cursorKey: string): string {
  return `${cursorKey}${ORDER_FEED_SEEDED_AT_SUFFIX}`;
}
