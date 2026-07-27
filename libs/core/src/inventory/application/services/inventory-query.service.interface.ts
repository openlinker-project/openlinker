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
  ProductStockAggregate,
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
   * with no inventory rows are zero-filled
   * (`{ totalAvailable: 0, locationCount: 0 }`) so the caller can build a
   * `Map<variantId, VariantAvailability>` directly. Output order matches
   * input order.
   */
  getAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]>;

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
}
