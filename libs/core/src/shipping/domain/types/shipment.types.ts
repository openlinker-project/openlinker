/**
 * Shipment Input Types
 *
 * Repository write contracts decoupled from the `Shipment` entity's
 * readonly shape. Mirrors the `CreateBulkOfferCreationBatchInput` /
 * `OfferCreationRecord` discipline — entity-shape changes (added fields,
 * derived behavior) don't silently affect repository callers.
 *
 * **Two creation modes** on `CreateShipmentInput`:
 *
 * - **Draft mode (default)**: omit `initialStatus`. The repository writes
 *   the row at `'draft'`. The dispatch path (`ShipmentDispatchService`,
 *   #835) uses this so a `generateLabel` failure leaves an observable
 *   `failed` row in `/shipments`. Branches 2/3 follow this path.
 * - **Atomic-terminal mode (#834)**: pass `initialStatus` (typically a
 *   non-draft value) + the matching terminal-timestamp field +
 *   optionally `trackingNumber`. The branch-1 projection path
 *   (`FulfillmentStatusSyncService`) uses this so the row is born at its
 *   correct status — no transient draft state to trip the partial-unique
 *   `(orderId, connectionId) WHERE providerShipmentId IS NULL` index, no
 *   `draft → terminal` two-write cycle.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { ShipmentStatus } from './shipment-status.types';
import type { ShippingMethod } from './shipping-method.types';

export interface CreateShipmentInput {
  /** Internal order id (`ol_order_*`). */
  orderId: string;
  /** Shipping-provider connection that will issue the label, or the OMP
   * connection for branch-1 projection rows. */
  connectionId: string;
  /** Which shipping shape this attempt produces. */
  shippingMethod: ShippingMethod;
  /** Pickup-point id — required for point-delivery methods (`'paczkomat'`
   * locker, `'pickup'` parcel-shop/PUDO #963); absent for `'kurier'`. */
  paczkomatId?: string;
  /** Source-side delivery-method id (`OrderShipping.methodId`) this shipment
   * was routed from. Persisted for audit/forensics (which marketplace method
   * produced the shipment) — distinct from the resolved provider
   * `deliveryMethodId` the adapter sends. */
  sourceDeliveryMethodId?: string;
  /** Atomic-terminal mode (#834). Defaults to `'draft'` (the dispatch
   * path's existing behaviour). Branch-1 projection sets this to the
   * snapshot's status at create-time so the row is born correct. */
  initialStatus?: ShipmentStatus;
  /** Atomic-terminal mode (#834). Backfill the row's tracking number at
   * create-time. */
  trackingNumber?: string;
  /** Atomic-terminal mode (#834). Set when `initialStatus === 'dispatched'`. */
  dispatchedAt?: Date;
  /** Atomic-terminal mode (#834). Set when `initialStatus === 'delivered'`. */
  deliveredAt?: Date;
  /** Atomic-terminal mode (#834). Set when `initialStatus === 'cancelled'`. */
  cancelledAt?: Date;
}

/**
 * Partial-update patch. Every field is optional — only the fields present
 * on the patch are written. Pass an explicit `null` for `errorMessage` to
 * clear a previously-recorded error (e.g. on a successful retry from
 * `failed` back to `draft`).
 */
export interface UpdateShipmentInput {
  status?: ShipmentStatus;
  providerShipmentId?: string;
  trackingNumber?: string;
  /**
   * Carrier-of-record (#769). Backfilled by `ShipmentStatusSyncService` from
   * `TrackingSnapshot.carrier` once the underlying carrier resolves
   * (asynchronously for Allegro Delivery; synchronously `'inpost'` for InPost
   * own-contract). Once-written-never-overwritten — the service skips the
   * write when `Shipment.carrier !== null`.
   */
  carrier?: string;
  labelPdfRef?: string;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  failedAt?: Date;
  errorMessage?: string | null;
}
