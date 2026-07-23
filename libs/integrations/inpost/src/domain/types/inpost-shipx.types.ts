/**
 * ShipX Wire Types
 *
 * Verbatim shapes for the InPost ShipX REST endpoints this adapter calls —
 * create shipment (simplified mode), label, cancel, tracking, points, and the
 * error body. Verified against the official ShipX EN docs
 * (dokumentacja-inpost.atlassian.net). Translated to/from the carrier-neutral
 * `@openlinker/core/shipping` types by `inpost-shipx.mapper.ts` — these wire
 * types never leak past the mapper/adapter boundary.
 *
 * @module libs/integrations/inpost/src/domain/types
 */

export const ShipXServiceValues = [
  'inpost_locker_standard',
  'inpost_courier_standard',
] as const;
export type ShipXService = (typeof ShipXServiceValues)[number];

export interface ShipXAddress {
  street: string;
  building_number: string;
  city: string;
  post_code: string;
  country_code: string;
}

export interface ShipXPeer {
  company_name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone: string;
  /** Omitted for locker shipments (addressed by `target_point`). */
  address?: ShipXAddress;
}

/** Locker parcel — a single size template (ShipX `parcels` is an object). */
export interface ShipXLockerParcel {
  template: string;
}

/** Courier parcel — explicit dims + weight (ShipX `parcels` is an array). */
export interface ShipXCourierParcel {
  dimensions: { length: string; width: string; height: string; unit: 'mm' };
  weight: { amount: string; unit: 'kg' };
  is_non_standard?: boolean;
}

/**
 * ShipX cash-on-delivery descriptor on a create-shipment request. `amount` is
 * a JSON number (not the OL decimal string) — the mapper converts. Emitted as an
 * add-on on both the courier and locker standard services (#1541 / #1554); a
 * shipment without this object is a regular prepaid parcel.
 */
export interface ShipXCod {
  amount: number;
  currency: string;
}

/**
 * ShipX insurance (declared-value) descriptor on a create-shipment request.
 * `amount` is a JSON number (not the OL decimal string) — the mapper converts.
 * Present only when the caller declared a value to insure; a shipment without
 * this object carries InPost's default (non-declared) liability.
 */
export interface ShipXInsurance {
  amount: number;
  currency: string;
}

export interface ShipXCreateShipmentRequest {
  sender: ShipXPeer;
  receiver: ShipXPeer;
  parcels: ShipXLockerParcel | readonly ShipXCourierParcel[];
  service: ShipXService;
  /** Stamped with the internal `ol_shipment_*` id for traceability. */
  reference?: string;
  /** Cash-on-delivery to collect. Omitted for prepaid shipments. */
  cod?: ShipXCod;
  /** Declared value to insure the parcel for. Omitted when the caller
   * declared none. */
  insurance?: ShipXInsurance;
  custom_attributes?: {
    sending_method?: string;
    /** Target paczkomat/locker id (e.g. `'BTO02M'`). */
    target_point?: string;
  };
}

/** Create-shipment response + the shipment-by-id resource (`GET /v1/shipments/:id`). */
export interface ShipXShipment {
  id: number;
  status: string;
  tracking_number: string | null;
}

export interface ShipXTrackingDetail {
  status: string;
  origin_status?: string;
  datetime?: string;
}

export interface ShipXTrackingResponse {
  tracking_number: string;
  status: string;
  tracking_details?: readonly ShipXTrackingDetail[];
}

export interface ShipXPoint {
  /** Locker code (e.g. `'POZ08A'`). */
  name: string;
  /**
   * Point-type tokens from `/v1/points` (e.g. `['parcel_locker']` for an
   * automat, `['parcel_locker','parcel_locker_superpop','pok','pop']` for a
   * PaczkoPunkt). String form tolerated for defensive parsing.
   */
  type?: readonly string[] | string;
  /** Human display name (e.g. `'InPost PaczkoPunkt POP-OLS19'`). */
  display_name?: string;
  status?: string;
  location?: { latitude: number; longitude: number };
  address?: { line1?: string; line2?: string };
  address_details?: {
    city?: string;
    post_code?: string;
    street?: string;
    building_number?: string;
  };
  opening_hours?: string;
}

export interface ShipXPointsResponse {
  items: readonly ShipXPoint[];
}

/**
 * ShipX error body — `error` is the machine key (`validation_failed`, `unauthorized`, …).
 *
 * `details` carries two confirmed shapes (#1807 — live-reproduced against the
 * sandbox): a **flat** per-field map (`{ name: ["required"] }`) for simple
 * top-level fields, and a **nested** array-of-objects map
 * (`{ custom_attributes: [{ target_point: ["does_not_exist"] }] }`) for
 * compound/nested request fields. `flattenShipXFieldErrors` in
 * `inpost-http-client.ts` normalises both into one flat leaf-keyed map.
 */
export interface ShipXErrorBody {
  status?: number;
  error?: string;
  message?: string;
  details?: Record<string, readonly string[] | ReadonlyArray<Record<string, readonly string[]>>>;
}
