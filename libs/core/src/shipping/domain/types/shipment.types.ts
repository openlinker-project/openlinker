/**
 * Shipment Input Types
 *
 * Repository write contracts decoupled from the `Shipment` entity's
 * readonly shape. Mirrors the `CreateBulkOfferCreationBatchInput` /
 * `OfferCreationRecord` discipline — entity-shape changes (added fields,
 * derived behavior) don't silently affect repository callers.
 *
 * Shipments always start at `'draft'`; the repository applies that
 * invariant at write time so the input type captures it.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { ShipmentStatus } from './shipment-status.types';
import type { ShippingMethod } from './shipping-method.types';

export interface CreateShipmentInput {
  /** Internal order id (`ol_order_*`). */
  orderId: string;
  /** Shipping-provider connection that will issue the label. */
  connectionId: string;
  /** Which shipping shape this attempt produces. */
  shippingMethod: ShippingMethod;
  /** Required when `shippingMethod === 'paczkomat'`; absent for kurier. */
  paczkomatId?: string;
  /** Source-side delivery-method id (`OrderShipping.methodId`) this shipment
   * was routed from. Persisted for audit/forensics (which marketplace method
   * produced the shipment) — distinct from the resolved provider
   * `deliveryMethodId` the adapter sends. */
  sourceDeliveryMethodId?: string;
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
