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
import { ReservationOrmEntity } from './infrastructure/persistence/entities/reservation.orm-entity';
import { InventoryRepository } from './infrastructure/persistence/repositories/inventory.repository';
import { LocationRepository } from './infrastructure/persistence/repositories/location.repository';
import { ReservationRepository } from './infrastructure/persistence/repositories/reservation.repository';
import { InventoryService } from './application/services/inventory.service';
import { InventorySyncService } from './application/services/inventory-sync.service';
import { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
import { InventoryQueryService } from './application/services/inventory-query.service';
import { LocationService } from './application/services/location.service';
import { AvailabilityService } from './application/services/availability.service';
import { EmptyReservationLedgerReader } from './infrastructure/reservations/empty-reservation-ledger.reader';
import { InventoryProvenanceBackfillService } from './application/services/inventory-provenance-backfill.service';
import {
  AVAILABILITY_SERVICE_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
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
  AVAILABILITY_SERVICE_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
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
    TypeOrmModule.forFeature([
      InventoryItemOrmEntity,
      InventoryLocationOrmEntity,
      ReservationOrmEntity,
    ]),
    ProductsModule, // Required for FK relationship to ProductOrmEntity
    IntegrationsModule, // Required for INTEGRATIONS_SERVICE_TOKEN (marketplace adapter resolution)
    IdentifierMappingModule, // Required for IDENTIFIER_MAPPING_SERVICE_TOKEN and CONNECTION_PORT_TOKEN (per-connection stock safety buffer, #1844/#2321)
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
    // #2343 — the advisory reservation ledger's write half. The
    // RESERVATION_LEDGER_READER_TOKEN binding below is deliberately NOT swapped
    // here: ATP subtraction is #2345, and keeping the reader empty is what makes
    // "an install with zero reservations publishes byte-identically to today"
    // a separately-testable regression rather than an assumption.
    ReservationRepository,
    // #2321 — the computed availability seam. `EmptyReservationLedgerReader` is
    // the Wave-1b stand-in: Wave 2 swaps this one binding for a real ledger
    // repository, which is why the ATP formula already carries the term.
    EmptyReservationLedgerReader,
    AvailabilityService,
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
      provide: RESERVATION_LEDGER_READER_TOKEN,
      useExisting: EmptyReservationLedgerReader,
    },
    {
      provide: RESERVATION_REPOSITORY_TOKEN,
      useExisting: ReservationRepository,
    },
    {
      provide: AVAILABILITY_SERVICE_TOKEN,
      useExisting: AvailabilityService,
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
    RESERVATION_LEDGER_READER_TOKEN,
    RESERVATION_REPOSITORY_TOKEN,
    AVAILABILITY_SERVICE_TOKEN,
    INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
  ],
})
export class InventoryModule {}

