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

// Domain Entities
export { InventoryItem as InventoryItemEntity } from './domain/entities/inventory-item.entity';

// Application Services
export { IInventoryService } from './application/services/inventory.service.interface';
export { InventoryService } from './application/services/inventory.service';
export { IInventorySyncService } from './application/services/inventory-sync.service.interface';
export { InventorySyncService } from './application/services/inventory-sync.service';
export { IMasterInventorySyncService, MasterInventorySyncResult } from './application/services/master-inventory-sync.service.interface';
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

// ORM entities are exposed on the host-only `@openlinker/core/inventory/orm-entities`
// sub-path (#594). Plugins must not import them from here.



