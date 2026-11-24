/**
 * Shipment polling rules (#4104)
 *
 * The status sync worker, not the browser, writes a shipment's tracking number
 * and its later statuses, and nothing pushes those changes to an open page.
 * These pure rules decide when the order page keeps re-reading its shipments
 * and when a changed status means the order itself must be re-read.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { Shipment, ShipmentStatus } from '../api/shipments.types';

/** How often an order page re-reads shipments that can still change. */
export const ORDER_SHIPMENTS_POLL_MS = 30_000;

/** Statuses the sync worker still moves forward. A draft has no label, a
 *  delivered, failed or cancelled shipment never changes again. */
const IN_PROGRESS_STATUSES: readonly ShipmentStatus[] = ['generated', 'dispatched', 'in-transit'];

/** True while at least one shipment can still change by itself. */
export function hasShipmentInProgress(shipments: readonly Pick<Shipment, 'status'>[]): boolean {
  return shipments.some((shipment) => IN_PROGRESS_STATUSES.includes(shipment.status));
}

/** One string that changes exactly when a shipment appears, disappears or
 *  changes status, so two reads can be compared without diffing objects. */
export function shipmentStatusSignature(
  shipments: readonly Pick<Shipment, 'id' | 'status'>[],
): string {
  return shipments
    .map((shipment) => `${shipment.id}:${shipment.status}`)
    .sort()
    .join('|');
}
