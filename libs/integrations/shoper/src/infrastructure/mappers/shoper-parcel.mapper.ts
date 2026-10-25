/**
 * Shoper Parcel Mapper
 *
 * Pure helpers for the fulfillment writeback (#3643): build the `POST /parcels`
 * body and decide, from the parcels an order already has, whether a `dispatched`
 * event still needs a write. Also the one reading of "was this order dispatched",
 * shared by the processor's fulfilment read-back (#834) and the source's
 * `OrderFulfillmentReadback` (#3365), so the two cannot disagree. No I/O.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type {
  ShoperParcel,
  ShoperParcelCreateRequest,
  ShoperShippingRow,
} from '../../domain/types/shoper-api.types';
import type { ShoperOrderStatusInfo } from '../../domain/types/shoper-order-status.types';
import { SHOPER_STATUS_TYPE } from '../../domain/types/shoper-order-status.types';
import type {
  ShoperParcelPlan,
  ShoperParcelShippingChoice,
} from '../../domain/types/shoper-parcel.types';
import { readShoperFlag } from './shoper-flag.mapper';
import { mapShoperOrderStatus } from './shoper-incoming-order.mapper';
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
    return {
      kind: 'attach-tracking',
      parcelId: String(untracked[0].parcel_id),
      alreadySent: readShoperFlag(untracked[0].sent) === true,
    };
  }
  // A new tracking number on an order that already has tracked parcels is a
  // second shipment; without lines OpenLinker cannot say what it carries, and a
  // parcel without products[] would ship a remainder of zero. Refused, not guessed.
  return { kind: 'conflict' };
}

/** A parcel Shoper records as sent: its `sent` flag, or a send date when the flag is absent. */
export function isShoperParcelSent(parcel: ShoperParcel): boolean {
  const flag = readShoperFlag(parcel.sent);
  if (flag !== undefined) {
    return flag;
  }
  return typeof parcel.send_date === 'string' && parcel.send_date.trim() !== '';
}

/**
 * Whether an order has left the shop, from its status and (when they could be
 * read) its parcels. `null` is "unknown" and never "not dispatched".
 *
 * - A sent parcel is proof on its own, whatever the status says: an order
 *   cancelled after its parcel left was still dispatched.
 * - A status of type 3 ("completed", the shop's sent bucket) is dispatched.
 * - Types 1 and 2 (new, in progress) are not.
 * - Type 4 splits by meaning. A cancellation is recognised and reads `false`. A
 *   refund or return usually FOLLOWS a shipment, so only the parcels can answer:
 *   none sent reads `false` (the processor's read-back draws the same line), and
 *   parcels that could not be read leave it unknown.
 * - A status the shop does not list, or a type outside 1-4, is unknown.
 *
 * `parcels` is `null` when the parcel read failed or was not made.
 */
export function readShoperDispatched(
  status: ShoperOrderStatusInfo | null,
  parcels: readonly ShoperParcel[] | null,
): boolean | null {
  if (parcels !== null && parcels.some(isShoperParcelSent)) {
    return true;
  }
  if (status === null) {
    return null;
  }
  switch (status.type) {
    case SHOPER_STATUS_TYPE.Completed:
      return true;
    case SHOPER_STATUS_TYPE.New:
    case SHOPER_STATUS_TYPE.InProgress:
      return false;
    case SHOPER_STATUS_TYPE.NotCompleted:
      if (mapShoperOrderStatus(status) === 'cancelled') {
        return false;
      }
      return parcels === null ? null : false;
    default:
      return null;
  }
}

export function normalizeTrackingNumber(value: string | undefined): string | undefined {
  return normalize(value);
}

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
