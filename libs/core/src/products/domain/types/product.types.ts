/**
 * Product Domain Types
 *
 * Type definitions for product domain operations. Defines product filters,
 * product creation/update types, and other product-related types used across
 * the products domain.
 *
 * @module libs/core/src/products/domain/types
 */
import type { Product } from '../entities/product.entity';
import type { ProductVariant } from '../entities/product-variant.entity';

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

// ---------------------------------------------------------------------------
// Read API types (used by repository ports and application services)
// ---------------------------------------------------------------------------

/**
 * Product list filters
 *
 * Criteria for querying the internal product store. All fields are optional —
 * omitting a field means no filter is applied for that dimension.
 */
export interface ProductListFilters {
  /** Case-insensitive search on product name or SKU */
  search?: string;
}

/**
 * Product variant list filters
 *
 * Criteria for querying the internal product variant store.
 */
export interface ProductVariantListFilters {
  /** Scope to variants of a single product */
  productId?: string;
  /** Case-insensitive search on SKU, EAN, or GTIN */
  search?: string;
  /** Scope to variants linked to a specific connection via identifier mappings */
  connectionId?: string;
  /** When true, only return variants with at least one non-empty identifier (EAN, GTIN, or SKU) */
  hasIdentifiers?: boolean;
}

/**
 * Offset-based pagination parameters
 */
export interface ProductPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated products result
 */
export interface PaginatedProducts {
  items: Product[];
  total: number;
}

/**
 * Paginated product variants result
 */
export interface PaginatedProductVariants {
  items: ProductVariant[];
  total: number;
}
