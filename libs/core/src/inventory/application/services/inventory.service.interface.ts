/**
 * Inventory Service Interface
 *
 * Defines the contract for inventory application operations. Implemented by
 * InventoryService to provide inventory management capabilities.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link InventoryService} for the implementation
 */
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';

/**
 * Inventory Service Interface
 *
 * Application service for inventory operations. Works with internal IDs only;
 * IdentifierMapping is handled by handlers, not by this service.
 */
export interface IInventoryService {
  /**
   * Set inventory (upsert by unique constraint)
   *
   * Upserts inventory by unique constraint: (productId, productVariantId, locationId).
   * If productVariantId is null, uses base inventory constraint.
   *
   * @param item - Inventory item domain entity with internal IDs
   * @returns Upserted inventory item domain entity
   */
  setInventory(item: InventoryItem): Promise<InventoryItem>;

  /**
   * Get inventory (optional but recommended)
   *
   * Thin wrapper over repository for future use cases (marketplace propagation,
   * API/UI visibility, reserved quantity logic) and debugging.
   *
   * @param productId - Internal OpenLinker product ID
   * @param productVariantId - Internal OpenLinker variant ID (optional, for variant-level stock)
   * @param locationId - Location ID (optional, for multi-location inventory)
   * @returns Inventory item domain entity or null if not found
   */
  getInventory(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null
  ): Promise<InventoryItem | null>;
}
