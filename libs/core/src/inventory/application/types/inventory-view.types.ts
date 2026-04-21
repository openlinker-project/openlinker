/**
 * Inventory View Types
 *
 * Application-layer view models that combine canonical inventory items with
 * joined product details. Produced by IInventoryQueryService for the HTTP
 * interface layer; not decorated for Swagger and not coupled to transport
 * concerns (no ISO-string dates — Date stays Date).
 *
 * @module libs/core/src/inventory/application/types
 */
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';

/**
 * Product details composed onto an inventory view. `null` on the parent
 * `InventoryItemView` when the upstream product lookup returned no row —
 * the inventory item still exists, we just have no product metadata to
 * surface.
 */
export interface InventoryViewProduct {
  name: string;
  sku: string | null;
  coverImageUrl: string | null;
}

/**
 * Inventory item + joined product details. `product` is `null` when the
 * item exists but its product lookup returned null. The raw `InventoryItem`
 * domain entity is exposed as `item` because the controller is the only
 * consumer and maps its fields 1:1 to the HTTP DTO.
 */
export interface InventoryItemView {
  item: InventoryItem;
  product: InventoryViewProduct | null;
}

/**
 * Paginated list result for `IInventoryQueryService.listInventoryItems`.
 */
export interface PaginatedInventoryView {
  items: InventoryItemView[];
  total: number;
}
