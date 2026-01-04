/**
 * Inventory Item Domain Entity
 *
 * Represents a canonical inventory item in the OpenLinker system. Inventory items
 * are stored with internal IDs only; external identifiers live in IdentifierMapping.
 * Supports both product-level and variant-level inventory (productVariantId is nullable).
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
  ) {}
}

