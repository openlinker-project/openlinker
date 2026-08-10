/**
 * buildOrderSummary — project an OrderRecord's snapshot into the neutral
 * order-summary shape used by the Shipments/Invoices list responses (#1995)
 *
 * A shipment or invoice must be able to show which order it belongs to
 * (order number, first line-item name/image, item count) without opening the
 * order detail page. Deliberately NOT built on `orderFromReadySnapshot`:
 * that rehydrator throws `OrderSnapshotUnavailableError` for any
 * `recordStatus` other than `ready` (or a redacted/missing buyer address),
 * and a shipment/invoice can legitimately reference an order in ANY state —
 * the list row must still render (as `null`/partial), never 500. This helper
 * therefore never throws: it degrades to `null` (no record, or no parseable
 * items) or to partial fields (e.g. a missing `orderNumber`) instead.
 *
 * @module libs/core/src/orders/domain
 */
import type { OrderRecord } from './entities/order-record.entity';
import type { OrderSummary } from './types/order-summary.types';

export type { OrderSummary } from './types/order-summary.types';

/**
 * Project an {@link OrderRecord} (or its absence) into an {@link OrderSummary}.
 *
 * @param record `undefined` when no order record resolved for the row's
 *   `orderId` (i.e. absent from a batched `findByIds` result).
 * @returns `null` when there is no record, or its snapshot's `items` is
 *   missing/empty/not an array. Otherwise an `OrderSummary` derived from the
 *   first item; individual fields fall back to `null` when unparseable.
 */
export function buildOrderSummary(record: OrderRecord | undefined): OrderSummary | null {
  if (!record) {
    return null;
  }
  const snapshot = record.orderSnapshot;
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  if (items.length === 0) {
    return null;
  }
  const first = (typeof items[0] === 'object' && items[0] !== null ? items[0] : {}) as Record<
    string,
    unknown
  >;

  return {
    orderNumber: typeof snapshot?.orderNumber === 'string' ? snapshot.orderNumber : null,
    firstItemName: typeof first.name === 'string' ? first.name : null,
    firstItemImageUrl: typeof first.imageUrl === 'string' ? first.imageUrl : null,
    itemCount: items.length,
  };
}
