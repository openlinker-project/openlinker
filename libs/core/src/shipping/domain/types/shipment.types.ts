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
  labelPdfRef?: string;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  failedAt?: Date;
  errorMessage?: string | null;
}
