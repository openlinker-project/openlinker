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
export {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_SYNC_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
} from './inventory.tokens';

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

// Types
export {
  InventoryAdjustment,
  InventoryFilters,
  InventoryPagination,
  PaginatedInventoryItems,
} from './domain/types/inventory.types';

// ORM Entities (exported for testing and TypeORM CLI usage)
export { InventoryItemOrmEntity } from './infrastructure/persistence/entities/inventory-item.orm-entity';



