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
  ShoperShippingRow,
} from '../../domain/types/shoper-api.types';
import type {
  ShoperParcelPlan,
  ShoperParcelShippingChoice,
} from '../../domain/types/shoper-parcel.types';
import { readShoperFlag } from './shoper-flag.mapper';
import { toPositiveInt } from './shoper-order-input.mapper';

/**
 * Shipping engines Shoper accepts a manually written parcel for. `POST /parcels`
 * answers 400 ("Nie znaleziono wartości") for every carrier-integrated method
 * (InPost, Paczka w Ruchu, DPD, DHL on the trial shop) and accepts the plain
 * `personal` one. Only `personal` has been confirmed live; another engine that
 * also accepts parcels must be confirmed against a real shop before it is added
 * here, because a wrong entry turns into a 400 on every dispatch.
 */
const PARCEL_WRITABLE_SHIPPING_ENGINES: ReadonlySet<string> = new Set(['personal']);

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

/** Whether Shoper accepts a parcel written by OpenLinker for this shipping method (see the engine list). */
export function acceptsShoperManualParcel(shipping: ShoperShippingRow): boolean {
  const engine = typeof shipping.engine === 'string' ? shipping.engine.trim().toLowerCase() : '';
  return PARCEL_WRITABLE_SHIPPING_ENGINES.has(engine);
}

/**
 * The shipping method a new parcel is written under. The operator's explicit
 * choice wins; else the order's own method when Shoper accepts a parcel for it
 * (so the parcel matches what the buyer chose); else the shop's first active
 * plain method. Null when none qualifies.
 *
 * `shippings` is only consulted when nothing is configured, so a caller that has
 * a configured id need not read the shop's methods at all.
 */
export function selectShoperParcelShipping(input: {
  readonly configuredShippingId: number | undefined;
  readonly orderShippingId: number | null;
  readonly shippings: readonly ShoperShippingRow[];
}): ShoperParcelShippingChoice | null {
  if (input.configuredShippingId !== undefined) {
    return { shippingId: input.configuredShippingId, source: 'config' };
  }
  if (input.orderShippingId !== null) {
    const own = input.shippings.find((row) => toPositiveInt(row.shipping_id) === input.orderShippingId);
    if (own !== undefined && acceptsShoperManualParcel(own)) {
      return { shippingId: input.orderShippingId, source: 'order' };
    }
  }
  for (const row of input.shippings) {
    const id = toPositiveInt(row.shipping_id);
    if (id !== null && readShoperFlag(row.active) !== false && acceptsShoperManualParcel(row)) {
      return { shippingId: id, source: 'fallback' };
    }
  }
  return null;
}

/**
 * Idempotency. The relay re-delivers an event (retry, late waybill #1947), and a
 * second parcel without `products[]` would try to ship a remainder of zero, so:
 * - the same tracking number already on a parcel -> nothing to do;
 * - a tracking number arriving for an order whose only parcel has none -> attach it;
 * - no tracking number and a parcel already exists -> nothing to do;
 * - parcels exist under other tracking numbers (or several are untracked) -> conflict;
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
  // second shipment; without lines OpenLinker cannot say what it carries, and a
  // parcel without products[] would ship a remainder of zero. Refused, not guessed.
  return { kind: 'conflict' };
}

export function normalizeTrackingNumber(value: string | undefined): string | undefined {
  return normalize(value);
}

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
