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

export interface ShipXCreateShipmentRequest {
  sender: ShipXPeer;
  receiver: ShipXPeer;
  parcels: ShipXLockerParcel | readonly ShipXCourierParcel[];
  service: ShipXService;
  /** Stamped with the internal `ol_shipment_*` id for traceability. */
  reference?: string;
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
  type?: readonly string[] | string;
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

/** ShipX error body — `error` is the machine key (`validation_failed`, `unauthorized`, …). */
export interface ShipXErrorBody {
  status?: number;
  error?: string;
  message?: string;
  details?: Record<string, readonly string[]>;
}
