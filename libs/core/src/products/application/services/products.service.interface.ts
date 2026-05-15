/**
 * Products Service Interface
 *
 * Defines the contract for product application operations. Implemented by
 * ProductsService to provide product management capabilities.
 *
 * @module libs/core/src/products/application/services
 * @see {@link ProductsService} for the implementation
 */
import type { Product } from '../../domain/entities/product.entity';
import type { ProductVariant } from '../../domain/entities/product-variant.entity';
import type {
  ProductListFilters,
  ProductVariantListFilters,
  ProductPagination,
  PaginatedProducts,
  PaginatedProductVariants,
} from '../../domain/types/product.types';

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

  /**
   * Get a single product by internal ID
   */
  getProduct(id: string): Promise<Product | null>;

  /**
   * Batch product lookup by internal id. Missing ids are silently dropped
   * (no null fillers) — caller maps results by `product.id` if presence
   * matters. Empty input returns `[]` without a DB round-trip; consumers
   * don't need a length guard before calling.
   */
  getProductsByIds(ids: string[]): Promise<Product[]>;

  /**
   * Get a single product variant by internal ID. Returns null when no row
   * matches; the caller decides between 404 and a soft fallback.
   */
  getVariant(id: string): Promise<ProductVariant | null>;

  /**
   * Variant lookup by SKU list. Used by offer-mapping reconciliation flows
   * to resolve marketplace external-refs / SKUs back to internal variants.
   * Empty input returns `[]` without a DB round-trip.
   */
  getVariantsBySkus(skus: string[]): Promise<ProductVariant[]>;

  /**
   * Variant lookup by EAN or GTIN list, scoped to a master-catalog
   * connection. The connection scope ensures variants on a different
   * master tenant don't collide on the same barcode. Empty input returns
   * `[]` without a DB round-trip.
   */
  getVariantsByBarcodes(
    connectionId: string,
    values: string[],
    field: 'ean' | 'gtin'
  ): Promise<ProductVariant[]>;

  /**
   * List products with optional filters and pagination
   */
  listProducts(
    filters: ProductListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProducts>;

  /**
   * List product variants with optional filters and pagination
   */
  listVariants(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants>;
}
