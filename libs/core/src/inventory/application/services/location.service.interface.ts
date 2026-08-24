/**
 * Location Service Interface
 *
 * Application contract for managing the operator-authored inventory locations
 * of ADR-058 decision (1). Exists at this layer so the CRUD API (#2316) is a
 * controller over an existing seam rather than a controller that also has to
 * invent the orchestration.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { InventoryLocation } from '../../domain/entities/inventory-location.entity';
import type {
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
  InventoryLocationFilters,
  InventoryLocationPagination,
  PaginatedInventoryLocations,
} from '../../domain/types/location.types';

export interface ILocationService {
  /**
   * Create a location, normalising `code` first.
   *
   * @throws DuplicateLocationCodeError when the normalised code is taken
   */
  createLocation(input: CreateInventoryLocationInput): Promise<InventoryLocation>;

  /**
   * Apply a partial update.
   *
   * @throws LocationNotFoundException when no location carries that id
   */
  updateLocation(
    id: string,
    input: UpdateInventoryLocationInput
  ): Promise<InventoryLocation>;

  /** @returns the location, or `null` when no row carries that id */
  getLocation(id: string): Promise<InventoryLocation | null>;

  listLocations(
    filters: InventoryLocationFilters,
    pagination: InventoryLocationPagination
  ): Promise<PaginatedInventoryLocations>;

  /**
   * Count the inventory positions pointing at this location.
   *
   * A read, not a guard — see `LocationRepositoryPort.countPositionsAtLocation`.
   * The CRUD API (#2316) calls it before `deleteLocation` so it can refuse with
   * a count the operator can act on.
   */
  countPositionsAtLocation(locationId: string): Promise<number>;

  /**
   * Delete a location.
   *
   * @throws LocationNotFoundException when no location carries that id
   */
  deleteLocation(id: string): Promise<void>;
}
