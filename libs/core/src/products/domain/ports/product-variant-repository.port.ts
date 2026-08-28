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
import type { ProductVariant } from '../entities/product-variant.entity';
import type {
  ProductVariantListFilters,
  ProductPagination,
  PaginatedProductVariants,
} from '../types/product.types';
import type { StoredTaxRate } from '../types/tax-rate.types';

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
   * Batch variant lookup for the given product IDs (#2172 review,
   * SUGGESTION 4) — a single query scoped to the given id set, as opposed to
   * a `Promise.all` fan-out over {@link findByProductId} once per product.
   * Empty input returns `[]` without a storage round-trip.
   *
   * @param productIds - Internal OpenLinker product IDs
   * @returns Array of product variant domain entities across every matching product
   */
  findByProductIds(productIds: readonly string[]): Promise<ProductVariant[]>;

  /**
   * Count variants per product for the given product IDs (#1720).
   * Returns a Map<productId, count>; products with zero variants are
   * omitted. Empty input returns an empty Map without a storage round-trip.
   *
   * @param productIds - Internal OpenLinker product IDs
   * @returns Map of productId to variant count
   */
  countByProductIds(productIds: readonly string[]): Promise<Map<string, number>>;

  /**
   * Count STALE variants (#1599 — deleted at the master) per product for the
   * given product IDs (#2447 — list-page "deleted at source" badge). Returns
   * a Map<productId, staleCount>; products with zero stale variants are
   * omitted, matching {@link countByProductIds}. Empty input returns an
   * empty Map without a storage round-trip.
   *
   * @param productIds - Internal OpenLinker product IDs
   * @returns Map of productId to stale-variant count
   */
  countStaleByProductIds(productIds: readonly string[]): Promise<Map<string, number>>;

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
   * Find variants by internal variant id list
   *
   * Batched counterpart to `findById`. Used where a caller holds a set of
   * variant ids and needs their owning products in one query rather than a
   * per-id fan-out (e.g. the bulk-batch summary projection, #2234).
   *
   * @param ids - Array of internal OpenLinker variant IDs
   * @returns Array of product variant domain entities (missing ids are omitted)
   */
  findByIdIn(ids: readonly string[]): Promise<ProductVariant[]>;

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
    field: 'ean' | 'gtin'
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

  /**
   * Find variants matching filters with offset pagination.
   * Results are ordered by createdAt DESC.
   */
  findMany(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants>;

  /**
   * Soft-mark every live variant of `productId` NOT in `keepVariantIds` as
   * stale (#1599 — deleted at the master). An empty keep-set marks all live
   * variants (the product-fully-deleted / 404 path). Returns the ids actually
   * flipped (already-stale rows are skipped, preserving their `staleAt`).
   *
   * @param productId - Internal OpenLinker product ID
   * @param keepVariantIds - Variant ids present in the current master response
   * @returns Ids of the variants newly marked stale
   */
  markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly string[]
  ): Promise<string[]>;

  /**
   * Record what the ProductMaster said about this variant's tax rate (#2054).
   *
   * A separate writer from `upsert` / `upsertMany`, for the same reason the
   * product side is: the ordinary sync upsert carries no rate, so letting it
   * round-trip these columns would blank a value the tax read just wrote.
   *
   * Written only by a master that keys tax per variant. On a product-keyed
   * master (PrestaShop) these rows stay untouched, so the product's rate
   * applies - `effectiveTaxRate` treats an absent override as "no opinion",
   * never as "no rate".
   */
  recordTaxRate(variantId: string, rate: StoredTaxRate): Promise<void>;

  /**
   * Remove any stored override, so the variant resolves through the product
   * again (#2054 review).
   *
   * The counterpart of `recordTaxRate`, and not expressible through it: an
   * `inherited` read means *this variant has no override*, which is the
   * genuinely-absent row (`code`, `country` and `readAt` all null) - not the
   * `{ code: null, readAt: <now> }` shape that says *the shop was asked and has
   * no rate*. Without this writer an override written once was never removed,
   * so a variant moved back to `tax_class: 'parent'` kept settling every order
   * line at its old rate forever.
   */
  clearTaxRate(variantId: string): Promise<void>;

  /** Read the stored override for one variant. `null` when the variant is unknown. */
  findTaxRate(variantId: string): Promise<StoredTaxRate | null>;
}
