/**
 * Shipment wire types — create command, shipment resource, offers, label and
 * tracking shapes for the ShipX `shipments` resource.
 *
 * Status is modelled as an open `string` (the ShipX state machine is large and
 * evolves); the well-known values are exported as constants for convenience.
 *
 * @module domain/types
 */

import type { Address, MonetaryAmount } from './common.types.ts';

export interface Contact {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly company_name?: string;
  readonly email?: string;
  readonly phone?: string;
  /** Required for courier delivery; omitted for parcel-locker delivery. */
  readonly address?: Address;
}

export type ParcelTemplate = 'small' | 'medium' | 'large' | (string & {});

export interface ParcelDimensions {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly unit?: 'mm' | 'cm';
}

export interface ParcelWeight {
  readonly amount: number;
  readonly unit?: 'kg' | 'g';
}

export interface Parcel {
  readonly id?: string;
  /** Size template for locker shipments; mutually exclusive with explicit dims. */
  readonly template?: ParcelTemplate;
  readonly dimensions?: ParcelDimensions;
  readonly weight?: ParcelWeight;
  readonly tracking_number?: string;
  readonly is_non_standard?: boolean;
}

export interface ShipmentCustomAttributes {
  /** Destination locker code for `inpost_locker_*` services. */
  readonly target_point?: string;
  /** How the parcel reaches InPost: `parcel_locker` | `dispatch_order` | `pop` | `branch`. */
  readonly sending_method?: string;
  /** Source locker code when `sending_method = parcel_locker`. */
  readonly dropoff_point?: string;
  readonly [extra: string]: unknown;
}

export interface CreateShipmentCommand {
  readonly receiver: Contact;
  readonly sender?: Contact;
  readonly parcels: ReadonlyArray<Parcel>;
  /** e.g. `inpost_locker_standard`. Omit to receive offers to pick from. */
  readonly service?: string;
  readonly custom_attributes?: ShipmentCustomAttributes;
  readonly reference?: string;
  readonly comments?: string;
  readonly insurance?: MonetaryAmount;
  readonly cod?: MonetaryAmount;
  readonly additional_services?: ReadonlyArray<string>;
  readonly external_customer_id?: string;
}

/** Well-known shipment statuses (non-exhaustive). */
export const SHIPMENT_STATUS = {
  CREATED: 'created',
  OFFERS_PREPARED: 'offers_prepared',
  OFFER_SELECTED: 'offer_selected',
  CONFIRMED: 'confirmed',
  DISPATCHED_BY_SENDER: 'dispatched_by_sender',
  CANCELED: 'canceled',
} as const;

export type ShipmentStatus = string;

/** ShipX returns carrier/service as `{ id, name, description }` objects on offers. */
export interface OfferCarrierRef {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface ShipmentOffer {
  readonly id: number;
  readonly status: string;
  readonly carrier: OfferCarrierRef | string;
  readonly service: OfferCarrierRef | string;
  readonly expires_at: string | null;
  readonly rate?: number | string | null;
  readonly currency?: string | null;
  readonly additional_services?: unknown;
  readonly unavailability_reasons?: unknown;
}

/** A buy attempt against a selected offer. `failure` carries the reason in `details`. */
export interface ShipmentTransaction {
  readonly id: number;
  readonly status: 'success' | 'failure' | 'processing' | (string & {});
  readonly offer_id: number;
  readonly details?: {
    readonly status?: number;
    readonly error?: string;
    readonly message?: string;
    readonly details?: unknown;
  };
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Shipment {
  readonly id: number;
  readonly status: ShipmentStatus;
  readonly tracking_number: string | null;
  readonly service: string | null;
  readonly reference: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly parcels: ReadonlyArray<Parcel>;
  readonly receiver: Contact;
  readonly sender: Contact;
  readonly custom_attributes: ShipmentCustomAttributes;
  readonly offers?: ReadonlyArray<ShipmentOffer>;
  readonly selected_offer?: ShipmentOffer | null;
  readonly transactions?: ReadonlyArray<ShipmentTransaction>;
  readonly [extra: string]: unknown;
}

export interface LabelOptions {
  /** Defaults to `pdf`. */
  readonly format?: 'pdf' | 'zpl' | 'epl';
  /** Defaults to `normal`. */
  readonly type?: 'normal' | 'A6' | 'A6P';
}

export interface TrackingDetail {
  readonly status: string;
  readonly datetime?: string;
  readonly [extra: string]: unknown;
}

export interface TrackingStatus {
  readonly tracking_number: string;
  readonly status: string;
  readonly custom_attributes?: Record<string, unknown>;
  readonly tracking_details?: ReadonlyArray<TrackingDetail>;
  readonly [extra: string]: unknown;
}
