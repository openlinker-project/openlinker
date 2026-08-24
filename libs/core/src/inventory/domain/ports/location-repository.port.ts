/**
 * Location Repository Port
 *
 * Persistence contract for the operator-authored inventory locations of
 * ADR-058 decision (1).
 *
 * Deliberately narrow: it declares only the operations this slice (#2313)
 * and the CRUD API on top of it (#2316) demonstrably use. It does not mirror
 * TypeORM's `Repository<T>` surface and carries no `save(entity)` catch-all —
 * a method lands here when a caller needs it, not in anticipation.
 *
 * @module libs/core/src/inventory/domain/ports
 * @see {@link LocationRepository} for the TypeORM implementation
 */
import type { InventoryLocation } from '../entities/inventory-location.entity';
import type {
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
  InventoryLocationFilters,
  InventoryLocationPagination,
  PaginatedInventoryLocations,
} from '../types/location.types';

export interface LocationRepositoryPort {
  /**
   * Insert a location, minting its `ol_location_*` id.
   *
   * `code` is expected to arrive already normalised — normalisation is the
   * application service's single responsibility, so the repository never
   * silently rewrites what the caller asked for.
   *
   * @throws DuplicateLocationCodeError when `UQ_inventory_locations_code` fires
   */
  create(input: CreateInventoryLocationInput): Promise<InventoryLocation>;

  /**
   * Apply a partial update. Only the fields present on `input` are written; an
   * explicit `null` clears a nullable column.
   *
   * @returns the updated location, or `null` when no row carries that id
   */
  update(id: string, input: UpdateInventoryLocationInput): Promise<InventoryLocation | null>;

  /** @returns the location, or `null` when no row carries that id */
  findById(id: string): Promise<InventoryLocation | null>;

  /** Filtered, paginated listing ordered by `code` for a stable page boundary. */
  list(
    filters: InventoryLocationFilters,
    pagination: InventoryLocationPagination
  ): Promise<PaginatedInventoryLocations>;

  /**
   * Count the inventory positions currently pointing at this location.
   *
   * A count, not a guard: it exists solely so the CRUD API (#2316) can report
   * a 409 with a number the operator can act on before `delete` runs. It
   * decides nothing and refuses nothing — the refusal lives with the caller
   * that reports the status, per `delete`'s docblock below.
   *
   * @returns the number of `inventory_items` rows carrying this `locationId`
   */
  countPositionsAtLocation(locationId: string): Promise<number>;

  /**
   * Remove a location.
   *
   * Refusing the delete while positions still reference the row is the caller's
   * decision, not this port's — the referential check belongs with the HTTP
   * surface that reports the 409 (#2316), and `inventory_items` carries no FK
   * that would enforce it here (ADR-058 decision 3).
   *
   * @returns `true` when a row was removed, `false` when none matched
   */
  delete(id: string): Promise<boolean>;
}
