/**
 * Shipments Feature Types
 *
 * Frontend transport types for the shipments API (#770). Mirrors the backend
 * `ShipmentResponseDto` contract (#846 + the #770 `customerId` enrichment). All
 * date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/shipments/api
 */

/**
 * Maximum page size accepted by `GET /shipments` (backend `@Max(100)` on the
 * list query DTO). Requesting a higher `limit` returns HTTP 400. Keep in sync
 * with the backend validator.
 */
export const SHIPMENTS_MAX_LIMIT = 100;

/** Default page size for the `/shipments` list — modest, since each page also
 * triggers up to N deduped order→customer lookups server-side. */
export const SHIPMENTS_PAGE_SIZE = 20;

export const SHIPMENT_STATUS_VALUES = [
  'draft',
  'generated',
  'dispatched',
  'in-transit',
  'delivered',
  'failed',
  'cancelled',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS_VALUES)[number];

export const SHIPPING_METHOD_VALUES = ['paczkomat', 'kurier'] as const;
export type ShippingMethod = (typeof SHIPPING_METHOD_VALUES)[number];

export interface Shipment {
  id: string;
  orderId: string;
  /** Internal customer id of the shipment's order (resolved server-side); null
   * when the order has no customer or is unknown. The UI resolves the display
   * name from it via `CustomerEntityLabel`. */
  customerId: string | null;
  connectionId: string;
  shippingMethod: ShippingMethod;
  status: ShipmentStatus;
  providerShipmentId: string | null;
  paczkomatId: string | null;
  trackingNumber: string | null;
  /**
   * Actual carrier-of-record (#769) — distinct from the dispatcher
   * (`connectionId.platformType`). Lowercase-kebab canonical form (see
   * `KNOWN_CARRIER_VALUES`). Drives the public-tracker URL composition in
   * `lib/carrier-tracking-url.ts`. Null until the carrier resolves
   * asynchronously (Allegro Delivery) or always populated synchronously
   * (`'inpost'` for own-contract InPost).
   */
  carrier: string | null;
  labelPdfRef: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Known carrier-of-record vocabulary (#769) — mirrors `KnownCarrierValues` in
 * `libs/core/src/shipping/domain/types/tracking-snapshot.types.ts`. Kept in
 * sync manually under the FE-001 hand-written-contract strategy. The
 * `carrier-tracking-url.ts` helper's unit test loops over this array, so
 * adding a known carrier here forces a URL-map update on the same PR.
 *
 * The wire shape accepts any string — plugin adapters can register new
 * carriers without a core PR — but the FE static URL map only deep-links
 * carriers in this list; unknown values render copy-text-only.
 */
export const KNOWN_CARRIER_VALUES = [
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
export type KnownCarrier = (typeof KNOWN_CARRIER_VALUES)[number];

/** `POST /shipments/generate-label` request body. Mirrors the BE
 * `GenerateLabelDto` shape verbatim. */
export interface GenerateLabelInput {
  sourceConnectionId: string;
  sourceDeliveryMethodId?: string | null;
  orderId: string;
  shippingMethod: ShippingMethod;
  paczkomatId?: string;
  recipient: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone: string;
    address?: {
      street: string;
      buildingNumber: string;
      city: string;
      postCode: string;
      countryCode: string;
    };
  };
  parcel: {
    template?: string;
    dimensions?: { length: number; width: number; height: number };
    weightGrams?: number;
  };
}

/** `POST /shipments/generate-label` response — mirrors `DispatchResultResponseDto`. */
export interface DispatchResult {
  kind: 'dispatched' | 'omp_fulfilled';
  shipment?: Shipment;
}

/** `POST /shipments/:id/notify-dispatched` response (#769). */
export interface NotifyDispatchedResult {
  shipmentId: string;
  outcome: 'notified' | 'skipped-not-generated';
  source: 'ok' | 'failed' | 'absent';
  destinations: ReadonlyArray<{
    connectionId: string;
    status: 'ok' | 'failed' | 'unsupported';
  }>;
}

export interface ShipmentFilters {
  orderId?: string;
  status?: ShipmentStatus;
  connectionId?: string;
  shippingMethod?: ShippingMethod;
  hasTracking?: boolean;
  /** Inclusive lower bound on createdAt (ISO 8601 / `YYYY-MM-DD`). */
  createdFrom?: string;
  /** Inclusive upper bound on createdAt (ISO 8601 / `YYYY-MM-DD`). */
  createdTo?: string;
}

export interface ShipmentPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedShipments {
  items: Shipment[];
  total: number;
  limit: number;
  offset: number;
}
