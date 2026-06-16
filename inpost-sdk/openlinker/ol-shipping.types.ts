/**
 * OpenLinker shipping contract — mirror copy.
 *
 * These types are a faithful, trimmed mirror of `@openlinker/core/shipping`
 * (the real `ShippingProviderManagerPort` surface and its neutral types). They
 * exist here only so this standalone prototype can simulate exactly what
 * OpenLinker's dispatch/status-sync/pickup-point services pass to and expect
 * from a shipping adapter — without importing the monorepo package graph.
 *
 * When this prototype graduates into `@openlinker/integrations-inpost`, these
 * are replaced by the real imports; the adapter logic stays.
 *
 * Source of truth: libs/core/src/shipping/domain/types/*.ts
 */

// ── shipping-method.types.ts ────────────────────────────────────────────────
export const ShippingMethodValues = ['paczkomat', 'pickup', 'kurier', 'omp'] as const;
export type ShippingMethod = (typeof ShippingMethodValues)[number];

// ── delivery-intent.types.ts ────────────────────────────────────────────────
export const DeliveryIntentValues = ['pickup_point', 'address'] as const;
export type DeliveryIntent = (typeof DeliveryIntentValues)[number];

// ── shipment-status.types.ts ────────────────────────────────────────────────
export const ShipmentStatusValues = [
  'draft',
  'generated',
  'dispatched',
  'in-transit',
  'delivered',
  'failed',
  'cancelled',
] as const;
export type ShipmentStatus = (typeof ShipmentStatusValues)[number];
export const TerminalShipmentStatusValues = ['delivered', 'failed', 'cancelled'] as const;

// ── tracking-snapshot.types.ts ──────────────────────────────────────────────
export const KnownCarrierValues = [
  'inpost',
  'dpd',
  'dhl',
  'orlen',
  'allegro-one-box',
  'allegro-one-punkt',
  'allegro-one-kurier',
  'poczta-polska',
  'ups',
  'packeta',
] as const;
export type KnownCarrier = (typeof KnownCarrierValues)[number];

export interface TrackingSnapshot {
  status: ShipmentStatus;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  trackingNumber?: string;
  carrier?: string;
  providerStatus?: string;
}

// ── shipment-recipient.types.ts ─────────────────────────────────────────────
export interface ShipmentAddress {
  street: string;
  buildingNumber: string;
  city: string;
  postCode: string;
  /** ISO 3166-1 alpha-2 (e.g. 'PL'). */
  countryCode: string;
}

export interface ShipmentRecipient {
  name?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  /** Optional for locker shipments; required by adapters for courier. */
  address?: ShipmentAddress;
}

// ── shipment-parcel.types.ts ────────────────────────────────────────────────
export interface ShipmentDimensions {
  /** Millimetres. */
  length: number;
  width: number;
  height: number;
}

export interface ShipmentParcel {
  /** Carrier size code — locker shipments ('small' | 'medium' | 'large'). */
  template?: string;
  /** Explicit dimensions (mm) — courier shipments. */
  dimensions?: ShipmentDimensions;
  /** Weight in grams — courier shipments. */
  weightGrams?: number;
}

// ── shipment-cod.types.ts ───────────────────────────────────────────────────
export interface ShipmentCod {
  /** Decimal string (e.g. '39.99'). */
  amount: string;
  /** ISO 4217 (e.g. 'PLN'). */
  currency: string;
}

// ── generate-label.types.ts ─────────────────────────────────────────────────
export interface GenerateLabelCommand {
  shipmentId: string;
  orderId: string;
  connectionId: string;
  shippingMethod: ShippingMethod;
  deliveryMethodId?: string;
  /** Pickup-point id (locker for paczkomat). Absent for kurier. */
  paczkomatId?: string;
  recipient: ShipmentRecipient;
  parcel: ShipmentParcel;
  cod?: ShipmentCod;
}

export interface GenerateLabelResult {
  providerShipmentId: string;
  trackingNumber: string | null;
  labelPdfRef: string;
}

// ── label-document.types.ts ─────────────────────────────────────────────────
export interface LabelDocument {
  contentType: string;
  body: Uint8Array;
}

// ── pickup-point.types.ts ───────────────────────────────────────────────────
export const PickupPointStatusValues = ['active', 'temporarily-unavailable'] as const;
export type PickupPointStatus = (typeof PickupPointStatusValues)[number];

export const PICKUP_POINT_STATUS = {
  Active: 'active',
  TemporarilyUnavailable: 'temporarily-unavailable',
} as const;

export interface PickupPointAddress {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface PickupPoint {
  providerId: string;
  name: string;
  address: PickupPointAddress;
  status: PickupPointStatus;
  lat?: number;
  lon?: number;
}

export interface FindPickupPointsQuery {
  city?: string;
  postalCode?: string;
  searchText?: string;
  limit?: number;
}

// ── connection config (libs/integrations/inpost/.../inpost-config.types) ─────
export interface InpostSenderContact {
  name: string;
  email: string;
  phone: string;
  address: ShipmentAddress;
}

export interface InpostConnectionConfig {
  environment: 'sandbox' | 'production';
  organizationId: string;
  senderAddress: InpostSenderContact;
  /**
   * ShipX courier service for the `kurier` method. Defaults to
   * `inpost_courier_standard` (requires a signed courier agreement + trucker id
   * on the org). Accounts without an agreement (prepaid / sandbox dev) must use
   * `inpost_courier_c2c`, which needs no contract.
   */
  courierService?: 'inpost_courier_standard' | 'inpost_courier_c2c' | (string & {});
}
