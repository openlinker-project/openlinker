/**
 * Inventory Repository Port
 *
 * Defines the contract for inventory persistence operations. Implemented by
 * infrastructure repositories to provide inventory storage capabilities.
 * This port abstracts the database implementation, allowing the application
 * layer to work with domain entities without depending on specific infrastructure.
 *
 * @module libs/core/src/inventory/domain/ports
 * @see {@link InventoryRepository} for the TypeORM implementation
 */
import type { InventoryItem } from '../entities/inventory-item.entity';
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantAvailability,
  PruneStaleVariantsResult,
} from '../types/inventory.types';

/**
 * Inventory Repository Port
 *
 * Interface for inventory persistence operations. Implementations handle
 * the specifics of the underlying database technology (TypeORM, etc.)
 * and map between domain entities and ORM entities.
 */
export interface InventoryRepositoryPort {
  /**
   * Find inventory by product and variant
   *
   * @param productId - Internal OpenLinker product ID
   * @param productVariantId - Internal OpenLinker variant ID (optional, for variant-level stock)
   * @param locationId - Location ID (optional, for multi-location inventory)
   * @returns Inventory item domain entity or null if not found
   */
  findByProductAndVariant(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null
  ): Promise<InventoryItem | null>;

  /**
   * Upsert inventory item (create or update by unique constraint)
   *
   * Upserts inventory by unique constraint: (productId, productVariantId, locationId).
   * If productVariantId is null, uses base inventory constraint.
   *
   * @param item - Inventory item domain entity with internal IDs
   * @returns Upserted inventory item domain entity
   */
  upsert(item: InventoryItem): Promise<InventoryItem>;

  /**
   * Find inventory item by ID
   */
  findById(id: string): Promise<InventoryItem | null>;

  /**
   * Find inventory items with filters and pagination
   */
  findMany(
    filters: InventoryFilters,
    pagination: InventoryPagination
  ): Promise<PaginatedInventoryItems>;

  /**
   * Summed per-variant availability across all locations for the given
   * variant IDs (#792 PR 2). Returns rows ONLY for variants that have at
   * least one matching inventory row; zero-filling for unknown variants is
   * the service layer's responsibility. Empty input → empty output.
   *
   * @param variantIds list of internal product-variant IDs to look up
   * @returns one VariantAvailability row per variant with inventory
   */
  findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]>;

  /**
   * Soft-mark orphaned inventory rows as stale (#1478).
   *
   * Marks every currently-live (`isStale = false`) row for `productId` whose
   * `productVariantId` is NOT in `keepVariantIds` as stale. `keepVariantIds` is
   * the set of variant keys present in the master's latest `listInventory`
   * response — including `null` for a product-level row. An empty keep set marks
   * every row for the product stale (the product was fully removed at the master).
   *
   * Does not touch already-stale rows, and does not bump `updatedAt` (a bulk
   * UPDATE, not a save) — so `updatedAt` keeps reflecting the last real stock
   * write. A variant that reappears clears its own flag via the upsert path.
   *
   * Granularity is per-variant, not per-location: a still-present variant that
   * the master stops returning at one specific location keeps all its location
   * rows live (the variant is still in `keepVariantIds`). Multi-location pruning
   * is out of scope.
   *
   * @param productId internal OpenLinker product ID
   * @param keepVariantIds variant keys to keep live (may include `null`)
   * @returns rows newly marked stale (`markedCount`) + the distinct non-null
   *   variant ids flagged (`variantIds`, for the master-deletion event)
   */
  markStaleExceptVariants(
    productId: string,
    keepVariantIds: readonly (string | null)[]
  ): Promise<PruneStaleVariantsResult>;
}
