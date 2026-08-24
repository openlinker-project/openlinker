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
  ProductStockAggregate,
  PruneStaleVariantsResult,
  DuplicatePositionReport,
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
   * On an EXISTING row the write is **column-scoped** (#2071): only the columns
   * the master sync owns are written (`availableQuantity`, `reservedQuantity`,
   * `isStale`, `sourceConnectionId`). The row's identity columns are never
   * rewritten, and `updatedAt`
   * is left to the database — so the returned item's `updatedAt` is the
   * DB-stamped value, NOT the `item.updatedAt` the caller passed in.
   * `InventorySyncService` builds the propagation dedupe key from that value,
   * which is why the master's timestamp must not survive the round-trip.
   *
   * **Precondition on `isStale`:** it is in the owned set only because
   * `MasterInventorySyncService` runs its `setInventory` loop BEFORE
   * `pruneStaleVariants`, keeping the two write sets disjoint. A new caller that
   * breaks that ordering must move `isStale` out of the owned set.
   *
   * `sourceConnectionId` (ADR-058 ladder step (i), #2314) is written on both
   * branches, so a pre-existing row acquires provenance on its next sync. A
   * caller with no connection axis passes `null`, which persists as "provenance
   * unknown" — legal until the #2317 backfill.
   *
   * @param item - Inventory item domain entity with internal IDs
   * @returns Upserted inventory item domain entity, carrying the DB-stamped `updatedAt`
   * @throws InventoryRowVanishedError if the matched row disappeared before the scoped UPDATE
   * @throws InventoryReturningUnsupportedError if the driver returned no usable `updatedAt`
   */
  upsert(item: InventoryItem): Promise<InventoryItem>;

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
   * Each row also carries `stockUpdatedAt` (`MAX(updatedAt)` across the
   * variant's live positions, #2321) — the observation time
   * `IAvailabilityService` reports as `PromisableQuantity.observedAt`.
   *
   * @param variantIds list of internal product-variant IDs to look up
   * @returns one VariantAvailability row per variant with inventory
   */
  findAvailabilityByVariantIds(
    variantIds: readonly string[]
  ): Promise<readonly VariantAvailability[]>;

  /**
   * Product-level stock aggregates for the given product IDs (#1720).
   *
   * Sums availableQuantity / reservedQuantity and takes MAX(updatedAt) across
   * each product's live (non-stale) inventory rows. Returns rows ONLY for
   * products that have at least one matching inventory row - products absent
   * from the result simply have no inventory; the caller decides whether to
   * zero-fill. Empty input returns [] without a storage round-trip.
   *
   * @param productIds list of internal product IDs to aggregate
   * @returns one ProductStockAggregate row per product with inventory
   */
  findStockAggregatesByProductIds(
    productIds: readonly string[]
  ): Promise<readonly ProductStockAggregate[]>;

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

  /**
   * Read-only scan for duplicate inventory positions (#2319, ADR-058 step (iii)).
   *
   * Groups every `inventory_items` row by the FOUR-column position key
   * (`productId`, `productVariantId`, `locationId`, `sourceConnectionId`) under
   * SQL `GROUP BY` NULL-equality and reports the groups holding more than one
   * row. Provenance is part of the key deliberately — see
   * {@link DuplicatePositionGroup}.
   *
   * Writes nothing. Includes stale rows (a stale duplicate still collides under
   * the index #2325 creates). Reports UNCAPPED totals alongside capped detail:
   * `groupCount` is the #2325 readiness gate and must reflect the whole table
   * even when `maxGroups` truncates `groups`.
   *
   * Deliberately takes no filter arguments. A filtered scan could report a clean
   * subset of a dirty table, and the gate's whole value is that it speaks for
   * the table the index will be built over.
   *
   * @param maxGroups upper bound on returned group DETAIL (totals are unbounded)
   */
  findDuplicatePositions(maxGroups: number): Promise<DuplicatePositionReport>;

  /**
   * Stamp the `'legacy'` provenance sentinel onto at most `limit` rows whose
   * `sourceConnectionId` is still NULL (#2317, ADR-058 ladder step (ii)).
   *
   * **The predicate is the cursor.** There is no offset argument and there must
   * never be one: `sourceConnectionId IS NULL` is self-consuming, so each call
   * removes its own page from the candidate set. An advancing offset over a
   * shrinking set steps over rows and leaves them unstamped forever — which
   * #2325 would then discover as a `SET NOT NULL` that cannot run.
   *
   * Writes exactly one column. `updatedAt` must NOT move: `InventorySyncService`
   * derives the propagation job's dedupe key from it, so bumping it across the
   * whole table would either replay every propagation or collide keys and drop
   * them. That requirement is what forces a raw statement here — see the
   * implementation.
   *
   * Concurrency-safe against a live sync by construction: rows already claimed
   * by another transaction are skipped rather than waited on, and a real
   * connection id written concurrently simply removes the row from this
   * predicate. The sentinel can only ever lose to a real id, never overwrite
   * one.
   *
   * @param limit maximum rows to stamp in this call (caller floors and clamps)
   * @returns how many rows this call actually stamped
   */
  backfillLegacyProvenance(limit: number): Promise<number>;

  /**
   * How many `inventory_items` rows still carry no provenance (#2317).
   *
   * The backfill's completion predicate and #2325's readiness gate read the
   * same number. Uncapped and unfiltered on purpose: a count of a subset could
   * report done while rows the `NOT NULL` will trip over sit outside it.
   */
  countMissingProvenance(): Promise<number>;
}
