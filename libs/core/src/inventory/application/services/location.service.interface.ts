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
import type { LocationBootstrapResult } from '../../domain/types/location-bootstrap.types';
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

  /**
   * How many locations are `active` right now.
   *
   * Exists for the fulfilment-routing enablement precondition (#2407): routing
   * against zero locations makes every line unfulfillable, so enabling it is
   * refused until at least one active location exists.
   *
   * **The `active` filter is load-bearing and is coupled to what
   * `bootstrapDefaultLocations` mints.** An `inactive` location cannot receive
   * work, so counting it would let the guard pass on a topology that routes
   * nothing — and if a future bootstrap spec minted `'inactive'`, the bootstrap
   * would be unable to satisfy the very guard it exists to unblock.
   */
  countActiveLocations(): Promise<number>;

  /**
   * Mint the first-run locations an operator was offered, idempotently.
   *
   * **Idempotent by unique code, not by a read-then-write.** Each spec is
   * attempted and `DuplicateLocationCodeError` is swallowed into
   * `existingCodes`; a `count === 0` check followed by a create would be a race
   * between two operators clicking at once. Same insert-then-recover shape as
   * `IdentifierMappingRepository.insertMapping`. Re-running creates nothing.
   *
   * Any other error propagates — only the duplicate is expected.
   */
  bootstrapDefaultLocations(): Promise<LocationBootstrapResult>;
}
