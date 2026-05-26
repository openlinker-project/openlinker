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
  labelPdfRef: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
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
