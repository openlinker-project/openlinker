/**
 * Product Master Port
 *
 * Defines the contract for product catalog operations. This port represents
 * the single source of truth for product data, variants, attributes, and categories.
 * Adapters implementing this port are responsible for:
 * - Fetching products from external platforms
 * - Transforming external product data to OpenLinker unified schema
 * - Replacing external IDs with internal OpenLinker IDs using IdentifierMappingService
 *
 * @module libs/core/src/products/domain/ports
 */
import { ProductFilters, ProductCreate, ProductUpdate, ProductVariantCreate } from '../types/product.types';
import type { ProductVariant } from '../entities/product-variant.entity';

// Re-exported so existing deep imports from this path keep working.
export type { ProductVariant } from '../entities/product-variant.entity';

/**
 * Product domain entity (minimal interface for port)
 * Full entity definition should be in domain/entities/product.entity.ts
 */
export interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string;
  price: number;
  currency?: string;
  weight?: number;
  images?: string[];
  categories?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Category domain entity
 */
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  /** Tree depth, if the source platform exposes one (PrestaShop, Allegro). */
  depth?: number;
  /** Whether the category is active in the source catalog. Defaults to true when absent. */
  active?: boolean;
}

/**
 * Product Master Port
 *
 * Single source of truth for product catalog. Manages product data,
 * variants, attributes, and categories.
 */
export interface ProductMasterPort {
  /**
   * Get product by ID
   *
   * Fetches a single product by its internal OpenLinker ID.
   * The adapter must resolve the internal ID to external ID using IdentifierMappingService.
   *
   * @param productId - Internal OpenLinker product ID
   * @returns Product with internal ID
   * @throws Error if product not found
   */
  getProduct(productId: string): Promise<Product>;

  /**
   * Get products with filters
   *
   * Fetches products from the external source matching the provided filters.
   * Returns products with internal OpenLinker IDs (not external platform IDs).
   *
   * @param filters - Filter criteria (category, status, query, pagination, etc.)
   * @returns Array of products with internal IDs
   */
  getProducts(filters?: ProductFilters): Promise<Product[]>;

  /**
   * Create a new product
   *
   * Creates a new product in the external system.
   * For MVP, this may throw NotSupportedException.
   *
   * @param product - Product creation payload
   * @returns Created product with internal ID
   * @throws NotSupportedException if not supported in MVP
   */
  createProduct(product: ProductCreate): Promise<Product>;

  /**
   * Update an existing product
   *
   * Updates an existing product in the external system.
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @param product - Product update payload
   * @returns Updated product with internal ID
   * @throws NotSupportedException if not supported in MVP
   */
  updateProduct(productId: string, product: ProductUpdate): Promise<Product>;

  /**
   * Delete a product
   *
   * Deletes a product from the external system.
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @throws NotSupportedException if not supported in MVP
   */
  deleteProduct(productId: string): Promise<void>;

  /**
   * Get product variants
   *
   * Fetches all variants for a product.
   *
   * @param productId - Internal OpenLinker product ID
   * @returns Array of product variants with internal IDs
   */
  getProductVariants(productId: string): Promise<ProductVariant[]>;

  /**
   * Create or update product variant
   *
   * Creates or updates a product variant in the external system.
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @param variant - Variant creation payload
   * @returns Created/updated variant with internal ID
   * @throws NotSupportedException if not supported in MVP
   */
  upsertProductVariant(productId: string, variant: ProductVariantCreate): Promise<ProductVariant>;

  /**
   * Get product categories
   *
   * Fetches all categories assigned to a product.
   *
   * @param productId - Internal OpenLinker product ID
   * @returns Array of categories with internal IDs
   */
  getProductCategories(productId: string): Promise<Category[]>;

  /**
   * Assign product to categories
   *
   * Assigns a product to one or more categories.
   * For MVP, this may throw NotSupportedException.
   *
   * @param productId - Internal OpenLinker product ID
   * @param categoryIds - Array of category IDs (internal IDs)
   * @throws NotSupportedException if not supported in MVP
   */
  assignCategories(productId: string, categoryIds: string[]): Promise<void>;

  /**
   * Search products by query
   *
   * Searches products by name, SKU, or description.
   *
   * @param query - Search query string
   * @param filters - Additional filter criteria
   * @returns Array of matching products with internal IDs
   */
  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]>;

  /**
   * List external product IDs from the source platform.
   *
   * Returns raw external identifiers (e.g. PrestaShop product IDs) without
   * creating identifier mappings or fetching full product bodies. Intended for
   * catalog-discovery fan-out, where the caller enqueues per-product sync jobs
   * keyed by external ID.
   *
   * Implementations SHOULD support `limit`/`offset` pagination; callers loop
   * until a short page (<limit) is returned.
   *
   * @param filters - Optional pagination filters
   * @returns Array of external IDs as strings (order is platform-defined)
   */
  listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]>;

  /**
   * List all categories from the product catalog (optional).
   *
   * Returns the full category tree for the connection.
   * Implementations that do not support this should omit the method.
   */
  getCategories?(): Promise<Category[]>;
}







