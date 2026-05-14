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
import type {
  ProductListFilters,
  ProductPagination,
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
   * Find products matching filters with offset pagination.
   * Results are ordered by createdAt DESC.
   */
  findMany(filters: ProductListFilters, pagination: ProductPagination): Promise<PaginatedProducts>;

  /**
   * Upsert product (create or update by internal ID)
   *
   * If product with given ID exists, updates it. Otherwise, creates new product.
   *
   * @param product - Product domain entity with internal ID
   * @returns Upserted product domain entity
   */
  upsert(product: Product): Promise<Product>;
}
