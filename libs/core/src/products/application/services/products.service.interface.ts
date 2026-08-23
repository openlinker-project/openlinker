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
  ProductListSort,
  PaginatedProducts,
  PaginatedProductVariants,
} from '../../domain/types/product.types';
import type { StoredTaxRate } from '../../domain/types/tax-rate.types';
import type {
  ConnectionTaxRateCoverage,
  TaxRateCoverage,
} from '../../domain/types/tax-rate-coverage.types';

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
   * Record what a ProductMaster said about a product's tax rate (#2054).
   *
   * Separate from `upsertProduct` on purpose: the sync upsert carries no rate,
   * so folding this into it would let an ordinary catalogue refresh blank a
   * rate - and a blanked rate holds documents.
   *
   * Recording `{ code: null, readAt }` is meaningful: it says *the master was
   * asked and has no rate*, which the gate treats differently from
   * *never asked*.
   */
  recordProductTaxRate(productId: string, rate: StoredTaxRate): Promise<void>;

  /** Record a per-variant override. Only a variant-keyed master calls this. */
  recordVariantTaxRate(variantId: string, rate: StoredTaxRate): Promise<void>;

  /**
   * Drop a per-variant override, because the shop says this variant inherits
   * the product's rate (#2054 review).
   *
   * Not the same write as `recordVariantTaxRate({ code: null, readAt })`: that
   * one records *asked, and this variant has no rate*, which reads as a gap on
   * an operator surface. This one restores the genuinely-absent override, so
   * `effectiveTaxRate` falls back to the product.
   *
   * Required rather than optional, because without it an override written once
   * was never removed - a variation moved back to `tax_class: 'parent'` kept
   * every order line at its stale rate, silently.
   */
  clearVariantTaxRate(variantId: string): Promise<void>;

  /**
   * The rate that applies to a line, resolved from the catalogue projection.
   * The variant override wins where present; otherwise the product's rate.
   */
  getEffectiveTaxRate(productId: string, variantId?: string): Promise<StoredTaxRate>;

  /** Catalogue coverage by tax-rate read state (#2054 / #2256). */
  getTaxRateCoverage(): Promise<TaxRateCoverage>;

  /**
   * The same coverage, per connection (#2256) - the unit an operator actually
   * fixes. "The catalogue has no rates" is not actionable when three shops feed
   * it and only one is incomplete.
   */
  getTaxRateCoverageByConnection(): Promise<ConnectionTaxRateCoverage[]>;

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
   * All variants belonging to a product, by internal product ID. A simple
   * product resolves to its single deterministic synthetic variant; a
   * combination product resolves to one variant per combination. An unknown
   * product yields `[]`. Used by master-inventory sync to key inventory to the
   * product's canonical variant (#822).
   */
  getVariantsByProductId(productId: string): Promise<ProductVariant[]>;

  /**
   * Variant lookup by SKU list. Used by offer-mapping reconciliation flows
   * to resolve marketplace external-refs / SKUs back to internal variants.
   * Empty input returns `[]` without a DB round-trip.
   */
  getVariantsBySkus(skus: string[]): Promise<ProductVariant[]>;

  /**
   * Variant lookup by internal variant id list. Batched counterpart to
   * `getVariant`, for callers holding a set of variant ids that need each
   * one's owning product without a per-id fan-out (#2234). Empty input
   * returns `[]` without a DB round-trip; unknown ids are omitted.
   */
  getVariantsByIds(ids: readonly string[]): Promise<ProductVariant[]>;

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
   * List products with optional filters, pagination, and sort (#1720).
   * Omitting `sort` preserves the historical default ordering
   * (createdAt DESC).
   */
  listProducts(
    filters: ProductListFilters,
    pagination: ProductPagination,
    sort?: ProductListSort
  ): Promise<PaginatedProducts>;

  /**
   * Count variants per product for the given product IDs (#1720 - list-page
   * display enrichment). Returns a Map<productId, count>; products with zero
   * variants are omitted. Empty input returns an empty Map without a DB
   * round-trip.
   */
  getVariantCountsByProductIds(productIds: readonly string[]): Promise<Map<string, number>>;

  /**
   * List product variants with optional filters and pagination
   */
  listVariants(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants>;

  /**
   * Soft-mark every live variant of `productId` NOT in `keepVariantIds` as
   * stale — deleted at the master (#1599). An empty keep-set marks all live
   * variants (product fully removed / 404). Returns the ids newly flipped so
   * the caller can emit a master-deletion event. Un-staling happens implicitly
   * on the next successful upsert of a reappearing variant.
   */
  markVariantsStaleExcept(productId: string, keepVariantIds: readonly string[]): Promise<string[]>;
}
