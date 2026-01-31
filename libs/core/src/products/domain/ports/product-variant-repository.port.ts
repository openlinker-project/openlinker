/**
 * Product Variant Repository Port
 *
 * Defines the contract for product variant persistence operations. Implemented by
 * infrastructure repositories to provide variant storage capabilities.
 * This port abstracts the database implementation, allowing the application
 * layer to work with domain entities without depending on specific infrastructure.
 *
 * @module libs/core/src/products/domain/ports
 * @see {@link ProductVariantRepository} for the TypeORM implementation
 */
import { ProductVariant } from '../entities/product-variant.entity';

/**
 * Product Variant Repository Port
 *
 * Interface for product variant persistence operations. Implementations handle
 * the specifics of the underlying database technology (TypeORM, etc.)
 * and map between domain entities and ORM entities.
 */
export interface ProductVariantRepositoryPort {
  /**
   * Find variant by internal ID
   *
   * @param id - Internal OpenLinker variant ID
   * @returns Product variant domain entity or null if not found
   */
  findById(id: string): Promise<ProductVariant | null>;

  /**
   * Find all variants for a product
   *
   * @param productId - Internal OpenLinker product ID
   * @returns Array of product variant domain entities
   */
  findByProductId(productId: string): Promise<ProductVariant[]>;

  /**
   * Find variant by SKU
   *
   * @param sku - SKU string
   * @returns Product variant domain entity or null if not found
   */
  findBySku(sku: string): Promise<ProductVariant | null>;

  /**
   * Find variants by SKU list
   *
   * @param skus - Array of SKU strings
   * @returns Array of product variant domain entities
   */
  findBySkuIn(skus: string[]): Promise<ProductVariant[]>;

  /**
   * Find variants by EAN or GTIN list, scoped to master catalog connection
   *
   * @param connectionId - Master catalog connection ID
   * @param values - Array of EAN/GTIN strings
   * @param field - Barcode field to match ('ean' or 'gtin')
   * @returns Array of product variant domain entities
   */
  findByEanOrGtinIn(
    connectionId: string,
    values: string[],
    field: 'ean' | 'gtin',
  ): Promise<ProductVariant[]>;

  /**
   * Upsert variant (create or update by internal ID)
   *
   * If variant with given ID exists, updates it. Otherwise, creates new variant.
   *
   * @param variant - Product variant domain entity with internal ID
   * @returns Upserted variant domain entity
   */
  upsert(variant: ProductVariant): Promise<ProductVariant>;

  /**
   * Upsert multiple variants for a product
   *
   * Upserts all provided variants. Useful for batch operations.
   *
   * @param variants - Array of product variant domain entities
   * @returns Array of upserted variant domain entities
   */
  upsertMany(variants: ProductVariant[]): Promise<ProductVariant[]>;
}

