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
import type { Shipment, ShipmentStatus } from '../api/shipments.types';

/**
 * Statuses from which a *new* label may be minted.
 *
 * `'delivered'` was dropped (#1905 review): the parcel arrived, so there is
 * nothing left to dispatch, and offering "Generate label" there contradicted
 * the row's own `View` severity while inviting a second paid label on a
 * completed shipment.
 *
 * Status alone is NOT sufficient authorisation — see `canRegenerateLabel`.
 */
export const CAN_GENERATE: ReadonlySet<ShipmentStatus | 'none'> = new Set([
  'none',
  'draft',
  'failed',
  'cancelled',
]);

/**
 * True when no carrier waybill has been minted for this shipment yet, so
 * dispatching creates the first (and only) label rather than a duplicate.
 */
export function isPreWaybill(shipment: Pick<Shipment, 'providerShipmentId'>): boolean {
  return shipment.providerShipmentId === null;
}

/**
 * Whether the "Generate / Regenerate label" affordance may be offered.
 *
 * `failed` is the trap `CAN_GENERATE` alone cannot see: it is not exclusively a
 * pre-waybill state. The InPost ShipX mapper folds seven POST-delivery outcomes
 * onto it (`returned_to_sender`, `rejected_by_receiver`, `undelivered`,
 * `undelivered_wrong_address`, `undelivered_cod_cash_receiver`,
 * `pickup_time_expired`, `stack_parcel_pickup_time_expired`), and those rows
 * still hold a live `providerShipmentId`. Because `findActiveByOrderId`
 * excludes terminal statuses and `findBranchOneByOrderAndConnection` requires
 * `providerShipmentId IS NULL`, such a row falls through to a fresh `create()`
 * — minting and charging a SECOND carrier label while the first is never
 * cancelled. So a `failed` row must additionally be pre-waybill.
 *
 * `cancelled` needs no such check: its waybill was explicitly voided with the
 * carrier, which is exactly why cancel-then-generate is the supported recovery
 * path for a post-waybill failure.
 */
export function canRegenerateLabel(
  shipment: Pick<Shipment, 'status' | 'providerShipmentId'>,
  canWrite: boolean,
): boolean {
  if (!canWrite) return false;
  if (!CAN_GENERATE.has(shipment.status)) return false;
  if (shipment.status === 'failed') return isPreWaybill(shipment);
  return true;
}

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
