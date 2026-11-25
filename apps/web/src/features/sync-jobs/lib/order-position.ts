/**
 * Order position keys
 *
 * A connection's order feed keeps its place under a key shaped
 * `<platform>.orders.<name>` (e.g. `prestashop.orders.dateUpd`). The seed marker
 * stored beside it (`....seededAt`) is bookkeeping, never a position to read
 * from. Mirrors the backend's `isOrderFeedCursorKey` - the browser cannot import
 * core (#591).
 *
 * @module apps/web/src/features/sync-jobs/lib
 */
const ORDER_POSITION_KEY = /^[a-z][a-z0-9-]*\.orders\.[A-Za-z]+$/;

export function isOrderPositionKey(cursorKey: string): boolean {
  return ORDER_POSITION_KEY.test(cursorKey);
}
