/**
 * Inventory Module
 *
 * NestJS module for inventory functionality. Configures TypeORM entities,
 * repositories, and services. Exports the inventory service and ports
 * for use in other modules.
 *
 * @module libs/core/src/inventory
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItemOrmEntity } from './infrastructure/persistence/entities/inventory-item.orm-entity';
import { InventoryRepository } from './infrastructure/persistence/repositories/inventory.repository';
import { InventoryService } from './application/services/inventory.service';
import { InventorySyncService } from './application/services/inventory-sync.service';
import { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_SYNC_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
} from './inventory.tokens';
import { ProductsModule } from '@openlinker/core/products';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';

// Re-export tokens for convenience
export {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_SYNC_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
} from './inventory.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItemOrmEntity]),
    ProductsModule, // Required for FK relationship to ProductOrmEntity
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN (marketplace adapter resolution)
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
  ],
  providers: [
    // Provide classes directly first
    InventoryRepository,
    InventoryService,
    InventorySyncService,
    MasterInventorySyncService,
    // Then provide token bindings using useExisting
    {
      provide: INVENTORY_REPOSITORY_TOKEN,
      useExisting: InventoryRepository,
    },
    {
      provide: INVENTORY_SERVICE_TOKEN,
      useExisting: InventoryService,
    },
    {
      provide: INVENTORY_SYNC_SERVICE_TOKEN,
      useExisting: InventorySyncService,
    },
    {
      provide: MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
      useExisting: MasterInventorySyncService,
    },
    // Also provide as string tokens for convenience
    {
      provide: 'InventoryRepositoryPort',
      useExisting: INVENTORY_REPOSITORY_TOKEN,
    },
    {
      provide: 'IInventoryService',
      useExisting: INVENTORY_SERVICE_TOKEN,
    },
    {
      provide: 'IInventorySyncService',
      useExisting: INVENTORY_SYNC_SERVICE_TOKEN,
    },
    {
      provide: 'IMasterInventorySyncService',
      useExisting: MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
    },
  ],
  exports: [
    INVENTORY_REPOSITORY_TOKEN,
    INVENTORY_SERVICE_TOKEN,
    INVENTORY_SYNC_SERVICE_TOKEN,
    MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
    'InventoryRepositoryPort',
    'IInventoryService',
    'IInventorySyncService',
    'IMasterInventorySyncService',
  ],
})
export class InventoryModule {}

