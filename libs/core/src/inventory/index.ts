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

// InventoryMasterPort sub-capabilities (#2648, ADR-048 decision 1): optional
// rungs of the master ladder, narrowed off the dispatched adapter with the
// co-located guard. Guard-only - never advertised in a manifest.
export type { BulkInventoryReader } from './domain/ports/capabilities/bulk-inventory-reader.capability';
export { isBulkInventoryReader } from './domain/ports/capabilities/bulk-inventory-reader.capability';

// Domain Entities
export { InventoryItem as InventoryItemEntity } from './domain/entities/inventory-item.entity';

// Domain exceptions
export { InventoryReturningUnsupportedError } from './domain/exceptions/inventory-returning-unsupported.error';
export { InventoryRowVanishedError } from './domain/exceptions/inventory-row-vanished.error';

// Application Services
export { IInventoryService } from './application/services/inventory.service.interface';
export { InventoryService } from './application/services/inventory.service';
export { IInventorySyncService } from './application/services/inventory-sync.service.interface';
export { InventorySyncService } from './application/services/inventory-sync.service';
export {
  IMasterInventorySyncService,
  MasterInventorySyncResult,
  MasterInventoryBatchSyncFailure,
  MasterInventoryBatchSyncResult,
} from './application/services/master-inventory-sync.service.interface';
export { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
export { IInventoryQueryService } from './application/services/inventory-query.service.interface';
export { InventoryQueryService } from './application/services/inventory-query.service';

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
} from './domain/types/inventory.types';

// Offer quantity write-order guard (#2617)
export {
  OFFER_QUANTITY_WRITE_LOCK_TTL_MS,
  isWritableQuantityObservation,
  offerQuantityObservationCursorKey,
  offerQuantityWriteLockKey,
} from './domain/types/offer-quantity-write-order.types';

// ORM entities are exposed on the host-only `@openlinker/core/inventory/orm-entities`
// sub-path (#594). Plugins must not import them from here.



