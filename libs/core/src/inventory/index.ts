/**
 * Inventory Module Exports
 *
 * Public API for the inventory module. Exports ports, types, domain entities,
 * and services for use by other modules and adapters.
 *
 * @module libs/core/src/inventory
 */

// Module
export { InventoryModule } from './inventory.module';

// Tokens
export * from './inventory.tokens';

// Ports
export { InventoryMasterPort, Inventory } from './domain/ports/inventory-master.port';
export { InventoryRepositoryPort } from './domain/ports/inventory-repository.port';
export { LocationRepositoryPort } from './domain/ports/location-repository.port';
export {
  ReservationLedgerReaderPort,
  SumReservedInput,
  ReservationAtpEffect,
  ReservationAtpEffectValues,
} from './domain/ports/reservation-ledger-reader.port';

// Domain Entities
export { InventoryItem as InventoryItemEntity } from './domain/entities/inventory-item.entity';
export { InventoryLocation } from './domain/entities/inventory-location.entity';

// Domain exceptions
export { InventoryReturningUnsupportedError } from './domain/exceptions/inventory-returning-unsupported.error';
export { InventoryRowVanishedError } from './domain/exceptions/inventory-row-vanished.error';
export { DuplicateLocationCodeError } from './domain/exceptions/duplicate-location-code.error';
export { LocationNotFoundException } from './domain/exceptions/location-not-found.exception';
export { LocationInUseError } from './domain/exceptions/location-in-use.error';
export { UnsupportedAvailabilityScopeError } from './domain/exceptions/unsupported-availability-scope.error';

// Application Services
export { IInventoryService } from './application/services/inventory.service.interface';
export { InventoryService } from './application/services/inventory.service';
export { IInventorySyncService } from './application/services/inventory-sync.service.interface';
export { InventorySyncService } from './application/services/inventory-sync.service';
export { IMasterInventorySyncService, MasterInventorySyncResult } from './application/services/master-inventory-sync.service.interface';
export { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
export { IInventoryQueryService } from './application/services/inventory-query.service.interface';
export {
  InventoryQueryService,
  MAX_DUPLICATE_POSITION_GROUPS,
  DEFAULT_DUPLICATE_POSITION_GROUPS,
} from './application/services/inventory-query.service';
export { ILocationService } from './application/services/location.service.interface';
export { LocationService } from './application/services/location.service';
export {
  IAvailabilityService,
  GetPromisableQuantitiesInput,
} from './application/services/availability.service.interface';
export { AvailabilityService } from './application/services/availability.service';
export { EmptyReservationLedgerReader } from './infrastructure/reservations/empty-reservation-ledger.reader';

// Application Types
export {
  InventoryItemView,
  InventoryViewProduct,
  PaginatedInventoryView,
} from './application/types/inventory-view.types';

// Types
export {
  InventoryAdjustment,
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
  VariantAvailability,
  ProductStockAggregate,
  PruneStaleVariantsResult,
  DuplicatePositionRow,
  DuplicatePositionGroup,
  DuplicatePositionReport,
} from './domain/types/inventory.types';
export {
  AvailabilityScope,
  AvailabilityProvenance,
  AvailabilityProvenanceValues,
  PromisableQuantity,
  computeAtp,
  toPromisableQuantity,
  unknownPromisableQuantity,
} from './domain/types/availability.types';
export {
  InventoryLocationKindValues,
  InventoryLocationKind,
  InventoryLocationStatusValues,
  InventoryLocationStatus,
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
  InventoryLocationFilters,
  InventoryLocationPagination,
  PaginatedInventoryLocations,
} from './domain/types/location.types';

// ORM entities are exposed on the host-only `@openlinker/core/inventory/orm-entities`
// sub-path (#594). Plugins must not import them from here.



