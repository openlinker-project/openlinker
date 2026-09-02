/**
 * Inventory Query Service Interface
 *
 * Defines the contract for cross-aggregate inventory read operations that
 * compose canonical inventory items with master-catalog product details.
 * Implemented by InventoryQueryService; consumed by the HTTP interface
 * layer in place of direct repository access.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link InventoryQueryService} for the implementation
 */
import type {
  InventoryFilters,
  InventoryPagination,
  VariantAvailability,
  VariantStockRow,
  ProductStockAggregate,
  DuplicatePositionReport,
} from '../../domain/types/inventory.types';
import type { PaginatedInventoryView } from '../types/inventory-view.types';

export interface IInventoryQueryService {
  /**
   * List inventory items with filters + pagination, composing product
   * details onto each item. `view.product` is `null` when the upstream
   * product lookup returned null for that item's productId.
   */
  listInventoryItems(
    filters: InventoryFilters,
    pagination: InventoryPagination
  ): Promise<PaginatedInventoryView>;

  /**
   * Batch per-variant availability lookup (#792 PR 2).
   *
   * Returns one row per requested variant ID with `availableQuantity`
   * summed across all locations and the distinct-location count. Variants
   * with no inventory rows are zero-filled so the caller can build a
   * `Map<variantId, VariantAvailability>` directly. Output order matches
   * input order.
   *
   * Each row also carries `availableToPromise` (#2323) — the GLOBAL-scope
   * answer from `IAvailabilityService`, i.e. `totalAvailable` net of OL's own
   * published reservations and with NO per-destination buffer applied (a
   * publishing caller applies the channel Control downstream). It is `null`
   * exactly when OpenLinker does not know, which a publishing caller must
   * treat as "suppress the write", never as zero and never as a reason to fall
   * back to `totalAvailable`.
   */
  getAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]>;

  /**
   * Presence-preserving counterpart of {@link getAvailabilityByVariantIds}
   * (#2765): returns a row ONLY for a variant that actually has non-stale
   * inventory rows, so an absent variant is absent rather than a `0`.
   *
   * The zero-fill above is right for a caller that publishes a quantity —
   * master is authoritative including 0 (#824). It is wrong for a caller
   * that RENDERS stock, because `0` and "never synced by an inventory
   * master" are then indistinguishable, and the operator is shown a red
   * "Out of stock" badge asserting something no adapter ever reported.
   * Ask for this read when the difference matters; keep the zero-filled one
   * when it does not.
   *
   * Returns the REPOSITORY-layer {@link VariantStockRow}, not the
   * service-layer {@link VariantAvailability} (#2323/#2765 integration): this
   * is a straight pass-through that consults no reservation ledger, so it
   * cannot answer `availableToPromise`, and inventing one here is exactly
   * what the #2323 shape split exists to prevent. A caller that must PUBLISH
   * a quantity uses {@link getAvailabilityByVariantIds}; this read serves
   * callers that RENDER stock.
   */
  findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantStockRow[]>;

  /**
   * Product-level stock aggregates for the given product IDs (#1720).
   *
   * Cross-context display-enrichment seam for the products catalog cockpit:
   * one row per product that has at least one live inventory row, with
   * available/reserved quantities summed across all rows and the most recent
   * stock write timestamp. Products with no inventory rows are absent from
   * the result - the caller decides how to present them (the API layer
   * zero-fills). Empty input returns []; input is capped at 200 IDs per call
   * (mirrors the availability read's request cap).
   */
  getProductStockAggregates(
    productIds: readonly string[]
  ): Promise<readonly ProductStockAggregate[]>;

  /**
   * Read-only duplicate inventory-position report (#2319, ADR-058 step (iii)).
   *
   * Detection only: nothing is repaired and nothing is written. Groups rows by
   * the FOUR-column position key (product, variant, location, source
   * connection) — provenance is part of the key because ADR-058 decision (2)
   * makes cross-source coexistence legitimate, so rows differing only in which
   * connection owns them are not duplicates.
   *
   * `groupCount` is the UNCAPPED #2325 readiness gate (0 ⇒ the recreated unique
   * index can be built); `maxGroups` bounds only the returned detail.
   *
   * @param maxGroups detail cap, default 100, hard maximum
   *   {@link MAX_DUPLICATE_POSITION_GROUPS}
   * @throws Error when `maxGroups` is out of range
   */
  getDuplicatePositionReport(maxGroups?: number): Promise<DuplicatePositionReport>;
}
