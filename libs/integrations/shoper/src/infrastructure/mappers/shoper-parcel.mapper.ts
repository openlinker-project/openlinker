/**
 * Shoper Parcel Mapper
 *
 * Pure helpers for the fulfillment writeback (#3643): build the `POST /parcels`
 * body and decide, from the parcels an order already has, whether a `dispatched`
 * event still needs a write. No I/O.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type {
  ShoperParcel,
  ShoperParcelCreateRequest,
} from '../../domain/types/shoper-api.types';
import type { ShoperParcelPlan } from '../../domain/types/shoper-parcel.types';

export function buildShoperParcelCreateRequest(
  orderId: number,
  shippingId: number,
  trackingNumber: string | undefined,
): ShoperParcelCreateRequest {
  return {
    order_id: orderId,
    shipping_id: shippingId,
    ...(trackingNumber === undefined ? {} : { shipping_code: trackingNumber }),
    sent: true,
  };
}

/**
 * Idempotency. The relay re-delivers an event (retry, late waybill #1947), and a
 * second parcel without `products[]` would try to ship a remainder of zero, so:
 * - the same tracking number already on a parcel -> nothing to do;
 * - a tracking number arriving for an order whose only parcel has none -> attach it;
 * - no tracking number and a parcel already exists -> nothing to do;
 * - otherwise -> create the parcel.
 */
export function planShoperParcelWrite(
  existing: readonly ShoperParcel[],
  trackingNumber: string | undefined,
): ShoperParcelPlan {
  if (trackingNumber !== undefined && existing.some((p) => normalize(p.shipping_code) === trackingNumber)) {
    return { kind: 'already-applied' };
  }
  if (existing.length === 0) {
    return { kind: 'create' };
  }
  if (trackingNumber === undefined) {
    return { kind: 'already-applied' };
  }
  const untracked = existing.filter((p) => normalize(p.shipping_code) === undefined);
  if (untracked.length === 1) {
    return { kind: 'attach-tracking', parcelId: String(untracked[0].parcel_id) };
  }
  // A new tracking number on an order that already has tracked parcels is a
  // second shipment; without lines OpenLinker cannot say what it carries.
  return { kind: 'create' };
}

export function normalizeTrackingNumber(value: string | undefined): string | undefined {
  return normalize(value);
}

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
