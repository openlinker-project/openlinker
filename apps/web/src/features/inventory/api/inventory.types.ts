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
