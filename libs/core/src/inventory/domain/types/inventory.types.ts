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






