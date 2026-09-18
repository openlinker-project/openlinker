/**
 * Inventory Feature Types
 *
 * Frontend transport types for the inventory API. Mirrors the backend
 * InventoryItemResponseDto and PaginatedInventoryResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/inventory/api
 */

export interface InventoryItem {
  id: string;
  productId: string;
  productVariantId: string | null;
  availableQuantity: number;
  reservedQuantity: number;
  locationId: string | null;
  updatedAt: string;
  productName: string | null;
  productSku: string | null;
  productImageUrl: string | null;
}

export interface InventoryFilters {
  productId?: string;
  productVariantId?: string;
  locationId?: string;
}

export interface InventoryPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedInventory {
  items: InventoryItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Per-variant availability returned by `GET /inventory/availability` (#792 PR 2).
 *
 * One entry per requested productVariantId; `totalAvailable=0` and
 * `locationCount=0` signal a variant with no inventory rows (zero-filled
 * server-side so consumers can build a `Map<variantId, …>` directly).
 */
export interface InventoryAvailability {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
}

export interface InventoryAvailabilityResponse {
  items: InventoryAvailability[];
}

/**
 * Duplicate-position report (#2319, ADR-058 step (iii)) — mirrors
 * `DuplicatePositionRowResponseDto` / `DuplicatePositionGroupResponseDto` /
 * `DuplicatePositionsResponseDto` on `GET /inventory/duplicate-positions`.
 *
 * Read-only diagnostic: nothing here is ever written back. `groupCount` is
 * the uncapped #2325 readiness gate (0 = ready); `groups` is capped by the
 * caller's `maxGroups` and `truncated` says whether that cap actually bit.
 */
export interface DuplicatePositionRow {
  id: string;
  availableQuantity: number;
  reservedQuantity: number;
  isStale: boolean;
  updatedAt: string;
}

export interface DuplicatePositionGroup {
  productId: string;
  productVariantId: string | null;
  locationId: string | null;
  sourceConnectionId: string | null;
  rowCount: number;
  liveRowCount: number;
  rows: DuplicatePositionRow[];
  /**
   * Display enrichment (#3239). `productName` is `null` only when the
   * product could not be resolved (e.g. deleted). `sku` is `null` both then
   * AND when the product resolved but simply carries no SKU — check
   * `productName` to tell the two apart. `connectionName` and
   * `locationName` stay `null` for the documented sentinel states —
   * `sourceConnectionId === null | 'legacy'` (not yet backfilled by #2317)
   * and `locationId === null` (ADR-058 decision 2, the master declines to
   * locate) — which are never resolved to a fabricated name.
   */
  productName: string | null;
  sku: string | null;
  connectionName: string | null;
  locationName: string | null;
}

export interface DuplicatePositionsReport {
  groupCount: number;
  rowCount: number;
  excessRowCount: number;
  groups: DuplicatePositionGroup[];
  truncated: boolean;
  generatedAt: string;
}

/**
 * Live status of the #2317 provenance backfill (#3240) — mirrors
 * `ProvenanceBackfillStatusResponseDto` on
 * `GET /inventory/provenance-backfill-status`. The second, independent
 * readiness condition for the #2325 stricter uniqueness index, alongside
 * `DuplicatePositionsReport.groupCount`. Always resolved live server-side —
 * never cached. The backfill DOES track two `connection_cursors` keys
 * (`sweepRemainingCountCursorKey` / `sweepCompletedAtCursorKey`), but a
 * persisted count can go stale — the pass self-latches and stops
 * recounting — which is exactly why this endpoint recounts live rather
 * than reading the cursor back.
 */
export interface ProvenanceBackfillStatus {
  remainingNull: number;
  completed: boolean;
  /**
   * The backfill's own persisted completion stamp (ISO timestamp), or null
   * if it has never latched. Non-null while `remainingNull > 0` means the
   * pass has stopped running on its own — a later mutation reintroduced a
   * NULL row after completion — and needs an operator to re-arm it. This
   * is the only field that tells "still draining" apart from "latched, and
   * stuck".
   */
  latchedAt: string | null;
}
