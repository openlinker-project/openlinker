/**
 * Product Repository Port
 *
 * Defines the contract for product persistence operations. Implemented by
 * infrastructure repositories to provide product storage capabilities.
 * This port abstracts the database implementation, allowing the application
 * layer to work with domain entities without depending on specific infrastructure.
 *
 * @module libs/core/src/products/domain/ports
 * @see {@link ProductRepository} for the TypeORM implementation
 */
import type { Product } from '../entities/product.entity';
import type { StoredTaxRate } from '../types/tax-rate.types';
import type {
  ProductListFilters,
  ProductPagination,
  ProductListSort,
  PaginatedProducts,
} from '../types/product.types';

/**
 * Product Repository Port
 *
 * Interface for product persistence operations. Implementations handle
 * the specifics of the underlying database technology (TypeORM, etc.)
 * and map between domain entities and ORM entities.
 */
export interface ProductRepositoryPort {
  /**
   * Find product by internal ID
   *
   * @param id - Internal OpenLinker product ID
   * @returns Product domain entity or null if not found
   */
  findById(id: string): Promise<Product | null>;

  /**
   * Batch product lookup by internal-id list. Missing ids are silently
   * dropped (no null fillers) — caller maps results by `product.id` if
   * presence matters.
   *
   * Implementations MUST short-circuit on `ids.length === 0` and return
   * `[]` without a storage round-trip. Consumers (incl. the in-memory
   * fake adapter at `@openlinker/core/products/testing`, when added)
   * rely on this contract; calling repositories with empty arrays is a
   * legitimate code path through `IProductsService.getProductsByIds`.
   */
  findByIds(ids: string[]): Promise<Product[]>;

  /**
   * Find products matching filters with offset pagination.
   *
   * `sort` is optional; omitting it preserves the historical default
   * ordering (createdAt DESC). Stock filters/sort aggregate the
   * inventory_items table (read-model reporting subquery, #1720).
   */
  findMany(
    filters: ProductListFilters,
    pagination: ProductPagination,
    sort?: ProductListSort
  ): Promise<PaginatedProducts>;

  /**
   * Upsert product (create or update by internal ID)
   *
   * If product with given ID exists, updates it. Otherwise, creates new product.
   *
   * @param product - Product domain entity with internal ID
   * @returns Upserted product domain entity
   */
  upsert(product: Product): Promise<Product>;

  /**
   * Record what the ProductMaster said about this product's tax rate (#2054).
   *
   * A **separate writer** from `upsert`, deliberately. The ordinary product
   * upsert runs on every sync and does not carry a rate, so round-tripping the
   * columns through it would null a value a tax read had just written - the
   * single-writer precedent `order_records.cancelledAt` already follows.
   *
   * Writing `{ code: null, readAt: <now> }` is meaningful and must be
   * persisted: it records *the master was asked and has no rate*, which is a
   * different fact from the untouched *never asked*.
   */
  recordTaxRate(productId: string, rate: StoredTaxRate): Promise<void>;

  /** Read the stored rate for one product. `null` when the product is unknown. */
  findTaxRate(productId: string): Promise<StoredTaxRate | null>;

  /**
   * Count the catalogue by tax-rate read state (#2054, ADR-052 § 4).
   *
   * Both populations must be answerable as a query rather than a crawl: the
   * missing count backs the operator surface and the pre-rollout coverage
   * measurement, the unchecked count backs the sync suggestion. Conflating
   * them is what would make day one read as an outage.
   */
  countTaxRateStates(): Promise<{ total: number; known: number; missing: number; notChecked: number }>;

  /**
   * The same counts, broken down per connection (#2256).
   *
   * The pre-rollout measurement is per SHOP, because that is the unit an
   * operator fixes: "the catalogue has no rates" is not actionable when three
   * shops feed it and only one is incomplete. `products` carries no connection
   * of its own, so the grouping comes from `identifier_mappings` - a product
   * mapped on two connections is counted under both, which is the honest
   * answer rather than an arbitrary pick.
   */
  countTaxRateStatesByConnection(): Promise<
    Array<{
      connectionId: string;
      platformType: string;
      total: number;
      known: number;
      missing: number;
      notChecked: number;
    }>
  >;
}
