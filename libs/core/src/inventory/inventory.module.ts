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
import { INVENTORY_REPOSITORY_TOKEN, INVENTORY_SERVICE_TOKEN } from './inventory.tokens';
import { ProductsModule } from '@openlinker/core/products';

// Re-export tokens for convenience
export {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
} from './inventory.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItemOrmEntity]),
    ProductsModule, // Required for FK relationship to ProductOrmEntity
  ],
  providers: [
    // Provide classes directly first
    InventoryRepository,
    InventoryService,
    // Then provide token bindings using useExisting
    {
      provide: INVENTORY_REPOSITORY_TOKEN,
      useExisting: InventoryRepository,
    },
    {
      provide: INVENTORY_SERVICE_TOKEN,
      useExisting: InventoryService,
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
  ],
  exports: [
    INVENTORY_REPOSITORY_TOKEN,
    INVENTORY_SERVICE_TOKEN,
    'InventoryRepositoryPort',
    'IInventoryService',
  ],
})
export class InventoryModule {}

