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

/**
 * FE mirror of the BE `ShippingMethodValues`
 * (`libs/core/src/shipping/domain/types/shipping-method.types.ts`).
 *
 * - `'paczkomat'` / `'kurier'` / `'pickup'` — provider-issued shipments
 *   (branches 2/3: InPost own-contract, Allegro Delivery source-brokered, DPD
 *   Polska courier + parcel-shop). `'pickup'` is the carrier-neutral
 *   parcel-shop / PUDO method (DPD Pickup, #963); like `'paczkomat'` it carries
 *   an operator- or buyer-supplied point id on `paczkomatId`.
 * - `'omp'` — **projection-only** rows (branch-1, #834): the destination OMP
 *   ships externally and OL holds no provider id / label.
 *   `FulfillmentStatusSyncService` is the sole writer. No
 *   `ShippingProviderManagerPort` ever advertises `omp`.
 *
 * Adding a new BE method requires widening this array AND
 * `SHIPPING_METHOD_LABEL` below — `Record<ShippingMethod, string>` makes the
 * compiler fail loudly on omission (intentional: stops the kind of FE↔BE
 * value-level drift that bit us in #886 — and the `'pickup'` mirror gap #966 fixed).
 */
export const SHIPPING_METHOD_VALUES = ['paczkomat', 'kurier', 'pickup', 'omp'] as const;
export type ShippingMethod = (typeof SHIPPING_METHOD_VALUES)[number];

/**
 * Carrier-neutral delivery intent — the dispatch *caller* contract (#979,
 * ADR-020). The operator/form expresses where the parcel goes; the BE dispatch
 * seam resolves the carrier-specific `ShippingMethod`. **FE mirror** of the BE
 * `DeliveryIntentValues` — keep in sync (same FE↔BE drift discipline as
 * `SHIPPING_METHOD_VALUES`, #966).
 */
export const DELIVERY_INTENT_VALUES = ['pickup_point', 'address'] as const;
export type DeliveryIntent = (typeof DELIVERY_INTENT_VALUES)[number];

/**
 * Operator-readable label per shipping method. Used by the `/shipments`
 * Method column and the method-filter dropdown so the UI doesn't surface raw
 * enum values. `Record<ShippingMethod, string>` (not `Partial<>`) so a new
 * method addition fails type-check until the label is supplied.
 */
export const SHIPPING_METHOD_LABEL: Record<ShippingMethod, string> = {
  paczkomat: 'Paczkomat',
  kurier: 'Kurier',
  pickup: 'Pickup point',
  omp: 'OMP-fulfilled',
};

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
  /** Carrier-neutral delivery intent (#979, ADR-020). The BE resolves the
   * concrete shipping method from this; the caller never names a carrier method. */
  deliveryIntent: DeliveryIntent;
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
  /** Optional cash-on-delivery to collect (operator-supplied, #966). COD-incapable
   * carriers ignore it server-side; DPD Polska translates it to its COD service. */
  cod?: {
    /** Amount as a decimal string (e.g. "129.90"). */
    amount: string;
    /** ISO 4217 currency code (e.g. PLN). */
    currency: string;
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
  /**
   * Branch discriminator at the row level (#882). `true` → only rows with a
   * provider-issued id (branches 2/3 — carrier-issued shipments);
   * `false` → only branch-1 projection rows (no provider id). Backed by
   * the BE `ShipmentFilters.hasProviderShipmentId` field shipped in #882.
   * Used by the `/shipments` processor filter to slice "Carrier" vs.
   * "OMP-fulfilled" rows.
   */
  hasProviderShipmentId?: boolean;
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
