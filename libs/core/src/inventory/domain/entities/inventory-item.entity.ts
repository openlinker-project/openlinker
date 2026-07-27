/**
 * Inventory Item Domain Entity
 *
 * Represents a canonical inventory item in the OpenLinker system. Inventory items
 * are stored with internal IDs only; external identifiers live in IdentifierMapping.
 * Supports both product-level and variant-level inventory (productVariantId is nullable).
 *
 * `isStale` soft-marks a row whose variant no longer appears in the master's
 * `listInventory` response (variant deleted at the master, #1478). Stale rows are
 * excluded from the variant-availability read the offer flows act on, but kept in
 * the table for debugging/history rather than hard-deleted. A variant that
 * reappears clears the flag on its next successful upsert.
 *
 * @module libs/core/src/inventory/domain/entities
 */
export class InventoryItem {
  constructor(
    public readonly id: string,
    public readonly productId: string,
    public readonly productVariantId: string | null,
    public readonly availableQuantity: number,
    public readonly reservedQuantity: number,
    public readonly locationId: string | null,
    public readonly updatedAt: Date,
    public readonly isStale: boolean = false,
  ) {}
}

