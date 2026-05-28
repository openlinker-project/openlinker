/**
 * Shipping Module
 *
 * NestJS module for the shipping bounded context. Registers
 * `ShipmentOrmEntity` privately (via `TypeOrmModule.forFeature`) and binds
 * the concrete `ShipmentRepository` to `SHIPMENT_REPOSITORY_TOKEN`.
 *
 * Exports only the Symbol-token bindings (`SHIPMENT_REPOSITORY_TOKEN`,
 * `SHIPMENT_DISPATCH_SERVICE_TOKEN`) — never `TypeOrmModule.forFeature(...)`
 * or the concrete classes, because consumers inject via the tokens and never
 * see `Repository<ShipmentOrmEntity>` directly. Keeping the ORM type private
 * to the module preserves the hexagonal boundary documented in
 * engineering-standards §"ORM ↔ Domain Mapping".
 *
 * Paczkomat caching (#766): binds `PICKUP_POINT_CACHE_TOKEN` to the
 * Redis-backed `RedisPickupPointCacheAdapter` and `PICKUP_POINT_LOOKUP_SERVICE_TOKEN`
 * to the read-through `PickupPointLookupService`. `CACHE_PORT_TOKEN` is provided
 * by the host-global `CacheModule` (`@openlinker/shared/cache`), so it is not
 * imported here.
 *
 * @module libs/core/src/shipping
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { MappingsModule } from '@openlinker/core/mappings';
import { OrdersModule } from '@openlinker/core/orders';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';

import { ShipmentOrmEntity } from './infrastructure/persistence/entities/shipment.orm-entity';
import { ShipmentRepository } from './infrastructure/persistence/repositories/shipment.repository';
import { RedisPickupPointCacheAdapter } from './infrastructure/adapters/redis-pickup-point-cache.adapter';
import { ShipmentDispatchService } from './application/services/shipment-dispatch.service';
import { ShipmentQueryService } from './application/services/shipment-query.service';
import { ShipmentCancellationService } from './application/services/shipment-cancellation.service';
import { PickupPointLookupService } from './application/services/pickup-point-lookup.service';
import { ShipmentDispatchNotificationService } from './application/services/shipment-dispatch-notification.service';
import { ShipmentStatusSyncService } from './application/services/shipment-status-sync.service';
import {
  PICKUP_POINT_CACHE_TOKEN,
  PICKUP_POINT_LOOKUP_SERVICE_TOKEN,
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  SHIPMENT_REPOSITORY_TOKEN,
  SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
} from './shipping.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentOrmEntity]),
    // #835 dispatch seam: resolve the processor via the routing model
    // (MappingsModule) and dispatch to the resolved connection's
    // ShippingProviderManager adapter (IntegrationsModule). No cycle — nothing
    // imports ShippingModule except the host app graph.
    IntegrationsModule,
    MappingsModule,
    // #837 mark-sent orchestration: resolve the order's source + destination
    // capabilities (OrdersModule) and the source's external order id
    // (IdentifierMappingModule). Acyclic — OrdersModule does not import ShippingModule.
    OrdersModule,
    IdentifierMappingModule,
  ],
  providers: [
    ShipmentRepository,
    {
      provide: SHIPMENT_REPOSITORY_TOKEN,
      useExisting: ShipmentRepository,
    },
    ShipmentDispatchService,
    {
      provide: SHIPMENT_DISPATCH_SERVICE_TOKEN,
      useExisting: ShipmentDispatchService,
    },
    ShipmentQueryService,
    {
      provide: SHIPMENT_QUERY_SERVICE_TOKEN,
      useExisting: ShipmentQueryService,
    },
    ShipmentCancellationService,
    {
      provide: SHIPMENT_CANCELLATION_SERVICE_TOKEN,
      useExisting: ShipmentCancellationService,
    },
    RedisPickupPointCacheAdapter,
    {
      provide: PICKUP_POINT_CACHE_TOKEN,
      useExisting: RedisPickupPointCacheAdapter,
    },
    PickupPointLookupService,
    {
      provide: PICKUP_POINT_LOOKUP_SERVICE_TOKEN,
      useExisting: PickupPointLookupService,
    },
    ShipmentDispatchNotificationService,
    {
      provide: SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
      useExisting: ShipmentDispatchNotificationService,
    },
    ShipmentStatusSyncService,
    {
      provide: SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
      useExisting: ShipmentStatusSyncService,
    },
  ],
  exports: [
    SHIPMENT_REPOSITORY_TOKEN,
    SHIPMENT_DISPATCH_SERVICE_TOKEN,
    SHIPMENT_QUERY_SERVICE_TOKEN,
    SHIPMENT_CANCELLATION_SERVICE_TOKEN,
    PICKUP_POINT_CACHE_TOKEN,
    PICKUP_POINT_LOOKUP_SERVICE_TOKEN,
    SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
    SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
  ],
})
export class ShippingModule {}
