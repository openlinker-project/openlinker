/**
 * Product Variant Domain Entity
 *
 * Represents a product variant (e.g., size/color combinations) in the OpenLinker
 * system. Variants are stored with internal IDs only; external identifiers live
 * in IdentifierMapping. Variants are linked to their parent product via productId.
 *
 * @module libs/core/src/products/domain/entities
 */
export class ProductVariant {
  constructor(
    public readonly id: string,
    public readonly productId: string,
    public readonly sku: string | null,
    public readonly attributes: Record<string, string> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly ean: string | null = null,
    public readonly gtin: string | null = null,
  ) {}
}

