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
// `ReservationRepositoryPort` (#2343) is deliberately NOT exported here. A
// `*RepositoryPort` is an intra-context contract — `check-cross-context-imports`
// denies the shape, and rightly: its consumers (#2344's ReservationService,
// #2345's ATP subtraction, #2349's reconciler) all live inside `inventory` and
// import it relatively. Anything outside this context reaches the ledger through
// an `I*Service`, never through the repository.
export {
  ReservationLedgerReaderPort,
  SumReservedInput,
  ReservationAtpEffect,
  ReservationAtpEffectValues,
} from './domain/ports/reservation-ledger-reader.port';

// Domain Entities
export { InventoryItem as InventoryItemEntity } from './domain/entities/inventory-item.entity';
export { InventoryLocation } from './domain/entities/inventory-location.entity';
export { Reservation } from './domain/entities/reservation.entity';

// Domain exceptions
export { InventoryReturningUnsupportedError } from './domain/exceptions/inventory-returning-unsupported.error';
export { InventoryRowVanishedError } from './domain/exceptions/inventory-row-vanished.error';
export { InventoryCrossSourcePositionConflictError } from './domain/exceptions/inventory-cross-source-position-conflict.error';
export { DuplicateLocationCodeError } from './domain/exceptions/duplicate-location-code.error';
export { LocationNotFoundException } from './domain/exceptions/location-not-found.exception';
export { LocationInUseError } from './domain/exceptions/location-in-use.error';
export { LocationOwnerConnectionNotFoundError } from './domain/exceptions/location-owner-connection-not-found.error';
export { UnsupportedAvailabilityScopeError } from './domain/exceptions/unsupported-availability-scope.error';
export { InsufficientAvailabilityError } from './domain/exceptions/insufficient-availability.error';
export { ReservationPositionUnavailableError } from './domain/exceptions/reservation-position-unavailable.error';
export { ReservationNotHeldError } from './domain/exceptions/reservation-not-held.error';
export { ReservationLedgerConstraintError } from './domain/exceptions/reservation-ledger-constraint.error';
export {
  AmbiguousReservationPositionError,
  AmbiguousReservationPosition,
} from './domain/exceptions/ambiguous-reservation-position.error';

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
export {
  IInventoryProvenanceBackfillService,
  InventoryProvenanceBackfillResult,
} from './application/services/inventory-provenance-backfill.service.interface';
export { InventoryProvenanceBackfillService } from './application/services/inventory-provenance-backfill.service';
export { ILocationService } from './application/services/location.service.interface';
export { LocationService } from './application/services/location.service';
export {
  IAvailabilityService,
  GetPromisableQuantitiesInput,
  ApplyPublishControlsInput,
  PublishControlResult,
} from './application/services/availability.service.interface';
export { AvailabilityService } from './application/services/availability.service';
export { IReservationService } from './application/services/reservation.service.interface';
export { ReservationService } from './application/services/reservation.service';

// Application Types
export {
  ReserveOrderLineInput,
  ReserveForOrderInput,
  ReserveForOrderResult,
  SkippedReservationLine,
  SkippedReservationReason,
  SkippedReservationReasonValues,
} from './application/types/reservation-service.types';
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
  VariantStockRow,
  VariantAvailability,
  ProductStockAggregate,
  PruneStaleVariantsResult,
  ProvenanceScope,
  DuplicatePositionRow,
  DuplicatePositionGroup,
  DuplicatePositionReport,
  InventoryPositionCandidate,
} from './domain/types/inventory.types';
export { LEGACY_SOURCE_CONNECTION_ID } from './domain/types/inventory.types';
export {
  AvailabilityScope,
  AvailabilityProvenance,
  AvailabilityProvenanceValues,
  PromisableQuantity,
  AtpAnswer,
  AtpAnsweredBy,
  ScopedAtpResult,
  computeAtp,
  applyScopedLedgerSubtraction,
  toPromisableQuantity,
  unknownPromisableQuantity,
} from './domain/types/availability.types';
export {
  ReservationStatusValues,
  ReservationStatus,
  ReservationTerminalStatusValues,
  ReservationTerminalStatus,
  ReservationKey,
  ReservationClaimInput,
  ReservationClaimOutcome,
  ReleaseReservationInput,
  ReservationPositionUnavailableReasonValues,
  ReservationPositionUnavailableReason,
} from './domain/types/reservation.types';
export {
  RESERVATION_TTL_MS_DEFAULT,
  RESERVATION_TTL_MS_MIN,
  RESERVATION_TTL_MS_MAX,
  RESERVATION_TTL_ENV_KEY,
  readReservationTtlMs,
  resolveReservationExpiry,
} from './domain/types/reservation-expiry.types';
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



