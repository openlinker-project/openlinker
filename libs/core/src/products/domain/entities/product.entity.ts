/**
 * Product Domain Entity
 *
 * Represents a canonical product in the OpenLinker system. Products are stored
 * with internal IDs only; external identifiers live in IdentifierMapping.
 * This entity is integration-agnostic and represents the single source of truth
 * for product data.
 *
 * @module libs/core/src/products/domain/entities
 */
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly sku: string | null,
    public readonly price: number | null,
    public readonly description: string | null,
    public readonly images: string[] | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  /**
   * First image URL by convention — the cover. Null if the product has no images.
   *
   * This is the canonical "which image represents the product" rule for the
   * Products bounded context. Consumers (e.g. inventory read endpoints) should
   * call this getter rather than replicating `images?.[0] ?? null` themselves.
   */
  get coverImageUrl(): string | null {
    return this.images?.[0] ?? null;
  }
}

