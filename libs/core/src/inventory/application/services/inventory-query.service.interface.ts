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
} from '../../domain/types/inventory.types';
import type { InventoryItemView, PaginatedInventoryView } from '../types/inventory-view.types';

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
   * Get a single inventory item by id, composing product details.
   * Returns `null` when the inventory item does not exist. `view.product`
   * is `null` when the item exists but its product lookup returned null.
   * Callers in the interface layer translate `null` to an HTTP 404.
   */
  getInventoryItem(id: string): Promise<InventoryItemView | null>;

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
}
