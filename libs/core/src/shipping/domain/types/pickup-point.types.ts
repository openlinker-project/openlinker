/**
 * Pickup Point Types
 *
 * Domain value type for paczkomat-style pickup points fetched from a
 * shipping provider (e.g. InPost ShipX `/v1/points`). Provider-fetched
 * and cached in Redis via `PickupPointCachePort` (#766) — NOT persisted
 * in the `shipments` table.
 *
 * Distinct from `OrderPickupPoint` in `@openlinker/core/orders`, which is
 * just the bare locker-id reference attached to a source order (e.g.
 * Allegro paczkomatowa orders carry `delivery.pickupPoint.id`). This type
 * carries the full provider-side metadata: status, coordinates, structured
 * opening hours.
 *
 * Opening hours preserved as a structured 7-day grid — InPost returns the
 * shape natively, and collapsing to a free-form string at the domain
 * boundary would be lossy (would foreclose future "open now?" /
 * "open this weekend?" filtering without a cache migration).
 *
 * @module libs/core/src/shipping/domain/types
 */

export const PickupPointStatusValues = ['active', 'temporarily-unavailable'] as const;
export type PickupPointStatus = (typeof PickupPointStatusValues)[number];

export const PICKUP_POINT_STATUS = {
  Active: 'active',
  TemporarilyUnavailable: 'temporarily-unavailable',
} as const satisfies Record<'Active' | 'TemporarilyUnavailable', PickupPointStatus>;

export const PickupPointDayValues = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const;
export type PickupPointDay = (typeof PickupPointDayValues)[number];

export const PICKUP_POINT_DAY = {
  Monday: 'mo',
  Tuesday: 'tu',
  Wednesday: 'we',
  Thursday: 'th',
  Friday: 'fr',
  Saturday: 'sa',
  Sunday: 'su',
} as const satisfies Record<
  'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday',
  PickupPointDay
>;

export interface PickupPointAddress {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

/**
 * Per-day open/close times. `intervals: null` means closed that day. Each
 * interval is an `HH:MM` range in the provider's local timezone (PL =
 * Europe/Warsaw for InPost). Multiple intervals per day support split-day
 * schedules (e.g. siesta breaks).
 */
export interface PickupPointDayHours {
  intervals: readonly { open: string; close: string }[] | null;
}

export type PickupPointOpeningHours = Readonly<Record<PickupPointDay, PickupPointDayHours>>;

export interface PickupPoint {
  /** Provider-issued id (e.g. InPost `'POZ08A'`). Globally unique per provider. */
  providerId: string;
  name: string;
  address: PickupPointAddress;
  status: PickupPointStatus;
  lat?: number;
  lon?: number;
  openingHours?: PickupPointOpeningHours;
}

/**
 * Query shape for `PickupPointFinder.findPickupPoints`. Co-located with
 * `PickupPoint` because it's part of the same domain concept and the only
 * consumer is the pickup-point-finder sub-capability.
 */
export interface FindPickupPointsQuery {
  city?: string;
  postalCode?: string;
  searchText?: string;
  limit?: number;
}
