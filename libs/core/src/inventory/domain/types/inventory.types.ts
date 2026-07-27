/**
 * Inventory Domain Types
 *
 * Type definitions for inventory domain operations. Defines inventory adjustment
 * types and other inventory-related types used across the inventory domain.
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { InventoryItem } from '../entities/inventory-item.entity';

/**
 * Inventory adjustment
 *
 * Represents an inventory adjustment operation (increase or decrease).
 * Used by InventoryMasterPort for adjusting stock levels.
 */
export interface InventoryAdjustment {
  /**
   * Product ID (internal OpenLinker ID)
   */
  productId: string;

  /**
   * Variant ID (internal OpenLinker ID, optional)
   * If provided, adjustment applies to variant stock
   */
  variantId?: string;

  /**
   * Location ID (optional, for multi-location inventory)
   */
  locationId?: string;

  /**
   * Quantity to adjust (positive for increase, negative for decrease)
   */
  quantity: number;

  /**
   * Reason for adjustment (optional)
   */
  reason?: string;

  /**
   * Additional metadata (optional)
   */
  metadata?: Record<string, unknown>;
}

/**
 * Inventory filters for list queries
 */
export interface InventoryFilters {
  productId?: string;
  productVariantId?: string;
  locationId?: string;
}

/**
 * Pagination parameters for inventory queries
 */
export interface InventoryPagination {
  limit: number;
  offset: number;
}

/**
 * Paginated inventory items result
 */
export interface PaginatedInventoryItems {
  items: InventoryItem[];
  total: number;
}

/**
 * Per-variant inventory availability summed across all locations.
 *
 * Returned by `InventoryRepositoryPort.findAvailabilityByVariantIds` and
 * `IInventoryQueryService.getAvailabilityByVariantIds`. The service-layer
 * call zero-fills entries for variants that have no inventory rows; the
 * repo-layer call returns only matched rows.
 *
 * Used by the bulk-wizard master-pull resolver (#792 PR 3).
 */
export interface VariantAvailability {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
}

/**
 * Product-level stock aggregate across all of a product's inventory rows
 * (#1720 - products catalog cockpit).
 *
 * Returned by `InventoryRepositoryPort.findStockAggregatesByProductIds` and
 * `IInventoryQueryService.getProductStockAggregates`. Rows exist only for
 * products that have at least one live (non-stale) inventory row; the caller
 * decides how to treat absent products (the API layer zero-fills for display).
 */
export interface ProductStockAggregate {
  productId: string;
  totalAvailable: number;
  totalReserved: number;
  /** MAX(updatedAt) across the product's inventory rows; null never occurs on returned rows but the shape allows it for zero-filled callers */
  stockUpdatedAt: Date | null;
}

/**
 * Result of a stale-marking prune (#1478 / #1599). `markedCount` is the total
 * rows newly flagged (may exceed `variantIds.length` — multiple location rows
 * per variant); `variantIds` is the distinct set of non-null variant ids
 * flagged, used to emit the master-deletion event. Product-level rows
 * (`productVariantId = NULL`) contribute to `markedCount` but not `variantIds`.
 */
export interface PruneStaleVariantsResult {
  markedCount: number;
  variantIds: string[];
}






