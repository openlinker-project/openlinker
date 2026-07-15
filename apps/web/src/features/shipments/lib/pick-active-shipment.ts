/**
 * Pick Active Shipment
 *
 * Shared precedence rule for choosing "the" shipment to represent an order
 * when more than one `Shipment` row exists for it (e.g. a cancelled label
 * followed by a re-generated one). Extracted from `OrderShipmentPanel` (#769)
 * so `OrderDetailPage`'s carrier resolution (#1617) uses the identical rule
 * instead of re-deriving its own.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { Shipment } from '../api/shipments.types';

/**
 * Pick the "active" shipment. In v1 there's at most one non-terminal shipment
 * per order (BE invariant). Prefer the most-recent non-terminal row; fall
 * back to the most-recent terminal one so operators can still see the
 * history of a delivered / cancelled / failed order. `items` is assumed
 * pre-sorted most-recent-first by the API.
 */
export function pickActiveShipment(items: readonly Shipment[] | null): Shipment | null {
  if (!items || items.length === 0) return null;
  const nonTerminal = items.find(
    (s) => s.status !== 'delivered' && s.status !== 'failed' && s.status !== 'cancelled',
  );
  return nonTerminal ?? items[0];
}
