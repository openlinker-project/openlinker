/**
 * Products Service Interface
 *
 * Defines the contract for product application operations. Implemented by
 * ProductsService to provide product management capabilities.
 *
 * @module libs/core/src/products/application/services
 * @see {@link ProductsService} for the implementation
 */
import { Product } from '../../domain/entities/product.entity';
import { ProductVariant } from '../../domain/entities/product-variant.entity';

/**
 * Products Service Interface
 *
 * Application service for product operations. Works with internal IDs only;
 * IdentifierMapping is handled by handlers, not by this service.
 */
export interface IProductsService {
  /**
   * Upsert product (create or update by internal ID)
   *
   * @param product - Product domain entity with internal ID
   * @returns Upserted product domain entity
   */
  upsertProduct(product: Product): Promise<Product>;

  /**
   * Upsert product variants
   *
   * Upserts all provided variants for a product. Useful for batch operations.
   *
   * @param productId - Internal OpenLinker product ID
   * @param variants - Array of product variant domain entities
   */
  upsertVariants(productId: string, variants: ProductVariant[]): Promise<void>;
}

