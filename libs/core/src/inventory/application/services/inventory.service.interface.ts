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
import type { PruneStaleVariantsResult } from '../../domain/types/inventory.types';

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

  /**
   * Prune stale variants after a master sync (#1478).
   *
   * Soft-marks every currently-live inventory row for `productId` whose variant
   * is NOT in `currentVariantIds` (the variant keys present in the master's
   * latest `listInventory` response, including `null` for a product-level row).
   * Rows for variants deleted at the master are flagged `isStale` and excluded
   * from the variant-availability read the offer flows act on. A variant that
   * reappears clears its own flag via `setInventory`.
   *
   * @param productId internal OpenLinker product ID
   * @param currentVariantIds variant keys still present at the master (may include `null`)
   * @returns rows newly marked stale (`markedCount`) + the distinct non-null
   *   variant ids flagged (`variantIds`), so the caller can emit a
   *   master-deletion event (#1599)
   */
  pruneStaleVariants(
    productId: string,
    currentVariantIds: readonly (string | null)[]
  ): Promise<PruneStaleVariantsResult>;
}
