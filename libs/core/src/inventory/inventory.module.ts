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
import { ReservationShortfallEpisodeOrmEntity } from './infrastructure/persistence/entities/reservation-shortfall-episode.orm-entity';
import { InventoryRepository } from './infrastructure/persistence/repositories/inventory.repository';
import { LocationRepository } from './infrastructure/persistence/repositories/location.repository';
import { ReservationRepository } from './infrastructure/persistence/repositories/reservation.repository';
import { ReservationShortfallRepository } from './infrastructure/persistence/repositories/reservation-shortfall.repository';
import { InventoryService } from './application/services/inventory.service';
import { InventorySyncService } from './application/services/inventory-sync.service';
import { MasterInventorySyncService } from './application/services/master-inventory-sync.service';
import { InventoryQueryService } from './application/services/inventory-query.service';
import { LocationService } from './application/services/location.service';
import { AvailabilityService } from './application/services/availability.service';
import { ReservationService } from './application/services/reservation.service';
import { ReservationExpiryService } from './application/services/reservation-expiry.service';
import { ReservationShortfallService } from './application/services/reservation-shortfall.service';
import { UnavailableOrderHoldReader } from './infrastructure/reservations/unavailable-order-hold.reader';
import type { ObligationReaders } from './domain/types/reservation-obligation.types';
import { ReservationLedgerReader } from './infrastructure/reservations/reservation-ledger.reader';
import { InventoryProvenanceBackfillService } from './application/services/inventory-provenance-backfill.service';
import {
  AVAILABILITY_SERVICE_TOKEN,
  RESERVATION_EXPIRY_SERVICE_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
  RESERVATION_OBLIGATION_READERS_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
  RESERVATION_SERVICE_TOKEN,
  RESERVATION_SHORTFALL_REPOSITORY_TOKEN,
  RESERVATION_SHORTFALL_SERVICE_TOKEN,
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
  RESERVATION_EXPIRY_SERVICE_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
  RESERVATION_OBLIGATION_READERS_TOKEN,
  RESERVATION_REPOSITORY_TOKEN,
  RESERVATION_SERVICE_TOKEN,
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
      ReservationShortfallEpisodeOrmEntity,
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
    // #2343 — the advisory reservation ledger's write half.
    ReservationRepository,
    ReservationShortfallRepository,
    ReservationShortfallService,
    ReservationService,
    // #2346 — the state-dependent expiry sweep. The obligation readers map is
    // bound as a VALUE rather than a class so its mapped type over
    // `ReservationObligationKindValues` is checked here: a kind added without a
    // reader fails to compile at this binding.
    UnavailableOrderHoldReader,
    ReservationExpiryService,
    // #2345 — the read half, now real. #2321's `EmptyReservationLedgerReader`
    // was the Wave-1b stand-in that let the ATP formula carry the ledger term
    // before the table existed; it survives only as a test fixture on the
    // `@openlinker/core/inventory/testing` sub-barrel and must never be bound
    // here again — binding it would silently switch ATP subtraction off.
    ReservationLedgerReader,
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
      useExisting: ReservationLedgerReader,
    },
    {
      provide: RESERVATION_REPOSITORY_TOKEN,
      useExisting: ReservationRepository,
    },
    {
      provide: RESERVATION_SERVICE_TOKEN,
      useExisting: ReservationService,
    },
    {
      provide: RESERVATION_OBLIGATION_READERS_TOKEN,
      // While `UnavailableOrderHoldReader` is bound here the sweep extends every
      // candidate and releases NOTHING (#2346). #2339 replaces this one entry
      // with a reader over `order_holds` — which must answer `'absent'` only on
      // a positively confirmed absence, never as a default.
      useFactory: (holds: UnavailableOrderHoldReader): ObligationReaders => ({
        'open-order-hold': (orderRecordId) => holds.read(orderRecordId),
      }),
      inject: [UnavailableOrderHoldReader],
    },
    {
      provide: RESERVATION_EXPIRY_SERVICE_TOKEN,
      useExisting: ReservationExpiryService,
    },
    {
      provide: RESERVATION_SHORTFALL_REPOSITORY_TOKEN,
      useExisting: ReservationShortfallRepository,
    },
    {
      provide: RESERVATION_SHORTFALL_SERVICE_TOKEN,
      useExisting: ReservationShortfallService,
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
    RESERVATION_SERVICE_TOKEN,
    RESERVATION_EXPIRY_SERVICE_TOKEN,
    RESERVATION_OBLIGATION_READERS_TOKEN,
    RESERVATION_SHORTFALL_REPOSITORY_TOKEN,
    RESERVATION_SHORTFALL_SERVICE_TOKEN,
    AVAILABILITY_SERVICE_TOKEN,
    INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN,
  ],
})
export class InventoryModule {}

