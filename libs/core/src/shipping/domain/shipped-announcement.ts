/**
 * Shipped Announcement Readiness
 *
 * When may `order.shipped` (#3554) be announced? A buyer-email rule on that
 * trigger tells the buyer their parcel left with its tracking number, and it
 * goes out once, so announcing before the number exists sends "Tracking
 * number: not yet" with no second email to correct it. Some carriers mint the
 * number minutes after dispatch (InPost ShipX at confirmation, #1947), so the
 * announcement waits for it, but not for ever: a shipment that has no number
 * a grace period after dispatch (a carrier that issues none, a pickup) is
 * announced without one rather than never. Pure, no I/O.
 *
 * @module libs/core/src/shipping/domain
 */
import type { ShipmentStatus } from './types/shipment-status.types';

/**
 * How long a dispatched shipment may wait for its tracking number before the
 * order is announced shipped without one. Long enough to cover a carrier that
 * mints the number on its next confirmation poll, short enough that a buyer
 * still hears about the dispatch the same hour.
 */
export const SHIPPED_TRACKING_GRACE_MS = 30 * 60 * 1000;

interface ShipmentTrackingFacts {
  status: ShipmentStatus;
  trackingNumber: string | null;
  dispatchedAt: Date | null;
  updatedAt: Date;
}

/** A label that was cancelled or failed never moves, so its number says nothing. */
const isLive = (shipment: ShipmentTrackingFacts): boolean =>
  shipment.status !== 'cancelled' && shipment.status !== 'failed';

/** Does any live outbound shipment already carry a tracking number? */
export function hasKnownTrackingNumber(shipments: readonly ShipmentTrackingFacts[]): boolean {
  return shipments.some(
    (shipment) =>
      isLive(shipment) &&
      typeof shipment.trackingNumber === 'string' &&
      shipment.trackingNumber.length > 0
  );
}

/**
 * Has this shipment waited long enough for a tracking number? Only a shipment
 * on its way without one qualifies; the clock starts at dispatch, falling back
 * to the last write for a row that never recorded the instant.
 */
export function isTrackingWaitOver(shipment: ShipmentTrackingFacts, now: Date): boolean {
  if (shipment.status !== 'dispatched' && shipment.status !== 'in-transit') return false;
  if (typeof shipment.trackingNumber === 'string' && shipment.trackingNumber.length > 0) {
    return false;
  }
  const since = shipment.dispatchedAt ?? shipment.updatedAt;
  return now.getTime() - since.getTime() >= SHIPPED_TRACKING_GRACE_MS;
}
