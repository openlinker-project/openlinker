/**
 * Product Domain Types
 *
 * Type definitions for product domain operations. Defines product filters,
 * product creation/update types, and other product-related types used across
 * the products domain.
 *
 * @module libs/core/src/products/domain/types
 */

/**
 * Product filters
 *
 * Filter criteria for querying products. All fields are optional.
 * Used by ProductMasterPort for filtering products.
 */
export interface ProductFilters {
  /**
   * Filter by category IDs
   */
  categoryIds?: string[];

  /**
   * Filter by product status
   */
  status?: string;

  /**
   * Search query (name, SKU, description)
   */
  query?: string;

  /**
   * Maximum number of products to return
   */
  limit?: number;

  /**
   * Number of products to skip (for pagination)
   */
  offset?: number;
}

/**
 * Product creation payload
 *
 * Used when creating a new product via ProductMasterPort.
 */
export interface ProductCreate {
  name: string;
  sku: string;
  description?: string;
  price: number;
  currency?: string;
  weight?: number;
  [key: string]: unknown;
}

/**
 * Product update payload
 *
 * Partial update payload for modifying an existing product.
 * Only provided fields will be updated.
 */
export interface ProductUpdate {
  name?: string;
  sku?: string;
  description?: string;
  price?: number;
  currency?: string;
  weight?: number;
  [key: string]: unknown;
}

/**
 * Product variant creation payload
 *
 * Used when creating or updating a product variant.
 */
export interface ProductVariantCreate {
  sku: string;
  attributes?: Record<string, string>;
  ean?: string;
  gtin?: string;
  price?: number;
  weight?: number;
  [key: string]: unknown;
}






