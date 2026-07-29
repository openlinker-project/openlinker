/**
 * Shipment Action Eligibility (#1826)
 *
 * Per-status action-eligibility sets, keyed on `ShipmentStatus` — a type the
 * `shipments` feature owns. Originally lived in `features/orders` (the
 * order-detail `ShipmentActionButtons` consumer), which put a `shipments`-typed
 * policy behind the `orders` barrel and created a near-cycle (`orders` barrel →
 * `shipment-action-buttons` → `shipments` barrel for `ShipmentStatus`/mutations).
 * Moved here so both `ShipmentActionButtons` (order-detail) and
 * `ShipmentRowDetail` (the `/shipments` accordion) depend on the owning
 * feature instead of on each other.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { ShipmentStatus } from '../api/shipments.types';

export const CAN_GENERATE: ReadonlySet<ShipmentStatus | 'none'> = new Set([
  'none',
  'draft',
  'delivered',
  'failed',
  'cancelled',
]);

export const CAN_CANCEL: ReadonlySet<ShipmentStatus> = new Set(['generated']);
export const CAN_NOTIFY_DISPATCHED: ReadonlySet<ShipmentStatus> = new Set(['generated']);
// A label document exists once the shipment is generated and stays retrievable
// through the carrier-tracked lifecycle; cancelled/failed/draft have none.
export const CAN_DOWNLOAD_LABEL: ReadonlySet<ShipmentStatus> = new Set([
  'generated',
  'dispatched',
  'in-transit',
  'delivered',
]);
