/**
 * Inventory Master Port
 *
 * Defines the contract for inventory/stock level operations. This port represents
 * the single source of truth for inventory data. Adapters implementing this port
 * are responsible for:
 * - Fetching inventory from external platforms
 * - Transforming external inventory data to OpenLinker unified schema
 * - Replacing external IDs with internal OpenLinker IDs using IdentifierMappingService
 *
 * @module libs/core/src/inventory/domain/ports
 */
import { InventoryAdjustment } from '../types/inventory.types';

/**
 * Inventory domain entity (minimal interface for port)
 * Full entity definition should be in domain/entities/inventory.entity.ts
 */
export interface Inventory {
  id: string;
  productId: string;
  variantId?: string;
  locationId?: string;
  quantity: number;
  reserved: number;
  available: number;
  updatedAt?: Date;
}

/**
 * Inventory Master Port
 *
 * Single source of truth for inventory/stock levels.
 */
export interface InventoryMasterPort {
  /**
   * Get current inventory for a product
   *
   * Fetches the current inventory/stock level for a product (or variant).
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param productId - Internal OpenLinker product ID
   * @param locationId - Optional location ID (for multi-location inventory)
   * @returns Inventory with internal IDs
   */
  getInventory(productId: string, locationId?: string): Promise<Inventory>;

  /**
   * Adjust inventory (increase or decrease)
   *
   * Adjusts the inventory quantity for a product or variant.
   * For MVP, this may throw NotSupportedException.
   *
   * @param adjustment - Inventory adjustment details
   * @returns Updated inventory with internal IDs
   * @throws NotSupportedException if not supported in MVP
   */
  adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory>;

  /**
   * Reserve inventory for an order
   *
   * Reserves inventory quantity for a pending order.
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @param quantity - Quantity to reserve
   * @param orderId - Internal OpenLinker order ID
   * @throws NotSupportedException if not supported in MVP
   */
  reserveInventory(productId: string, quantity: number, orderId: string): Promise<void>;

  /**
   * Release reserved inventory
   *
   * Releases previously reserved inventory (e.g., when order is cancelled).
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @param quantity - Quantity to release
   * @param orderId - Internal OpenLinker order ID
   * @throws NotSupportedException if not supported in MVP
   */
  releaseInventory(productId: string, quantity: number, orderId: string): Promise<void>;

  /**
   * Get available quantity (total - reserved)
   *
   * Returns the available quantity for a product (total quantity minus reserved).
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param productId - Internal OpenLinker product ID
   * @param locationId - Optional location ID (for multi-location inventory)
   * @returns Available quantity (number)
   */
  getAvailableQuantity(productId: string, locationId?: string): Promise<number>;
}






