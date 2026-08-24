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
import { InventoryLocationOrmEntity } from './infrastructure/persistence/entities/inventory-location.orm-entity';
import { InventoryRepository } from './infrastructure/persistence/repositories/inventory.repository';
import { LocationRepository } from './infrastructure/persistence/repositories/location.repository';
import { InventoryService } from './application/services/inventory.service';
import { InventorySyncService } from './application/services/inventory-sync.service';
import { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
import { InventoryQueryService } from './application/services/inventory-query.service';
import { LocationService } from './application/services/location.service';
import { InventoryProvenanceBackfillService } from './application/services/inventory-provenance-backfill.service';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_SYNC_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
  LOCATION_REPOSITORY_TOKEN,
  LOCATION_SERVICE_TOKEN,
  INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
} from './inventory.tokens';
import { ProductsModule } from '@openlinker/core/products';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { EventsModule } from '@openlinker/core/events';

// Re-export tokens for convenience
export {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  INVENTORY_SYNC_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
  LOCATION_REPOSITORY_TOKEN,
  LOCATION_SERVICE_TOKEN,
  INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
} from './inventory.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItemOrmEntity, InventoryLocationOrmEntity]),
    ProductsModule, // Required for FK relationship to ProductOrmEntity
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN (marketplace adapter resolution)
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN
    SyncModule, // Required for SYNC_JOB_QUEUE_TOKEN (inventory propagation enqueue)
    EventsModule, // Required for EVENT_PUBLISHER_TOKEN (master-deletion event, #1599)
  ],
  providers: [
    // Provide classes directly first
    InventoryRepository,
    InventoryService,
    InventorySyncService,
    MasterInventorySyncService,
    InventoryQueryService,
    LocationRepository,
    LocationService,
    InventoryProvenanceBackfillService,
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
    {
      provide: INVENTORY_QUERY_SERVICE_TOKEN,
      useExisting: InventoryQueryService,
    },
    {
      provide: LOCATION_REPOSITORY_TOKEN,
      useExisting: LocationRepository,
    },
    {
      provide: LOCATION_SERVICE_TOKEN,
      useExisting: LocationService,
    },
    {
      provide: INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
      useExisting: InventoryProvenanceBackfillService,
    },
  ],
  exports: [
    INVENTORY_REPOSITORY_TOKEN,
    INVENTORY_SERVICE_TOKEN,
    INVENTORY_SYNC_SERVICE_TOKEN,
    MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
    INVENTORY_QUERY_SERVICE_TOKEN,
    LOCATION_REPOSITORY_TOKEN,
    LOCATION_SERVICE_TOKEN,
    INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
  ],
})
export class InventoryModule {}

