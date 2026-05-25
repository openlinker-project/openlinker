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
 * No binding for `PICKUP_POINT_CACHE_TOKEN` here — the Redis-backed
 * adapter implementation is provided by #766 (paczkomat caching service).
 *
 * @module libs/core/src/shipping
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { MappingsModule } from '@openlinker/core/mappings';

import { ShipmentOrmEntity } from './infrastructure/persistence/entities/shipment.orm-entity';
import { ShipmentRepository } from './infrastructure/persistence/repositories/shipment.repository';
import { ShipmentDispatchService } from './application/services/shipment-dispatch.service';
import { SHIPMENT_DISPATCH_SERVICE_TOKEN, SHIPMENT_REPOSITORY_TOKEN } from './shipping.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentOrmEntity]),
    // #835 dispatch seam: resolve the processor via the routing model
    // (MappingsModule) and dispatch to the resolved connection's
    // ShippingProviderManager adapter (IntegrationsModule). No cycle — nothing
    // imports ShippingModule except the host app graph.
    IntegrationsModule,
    MappingsModule,
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
  ],
  exports: [SHIPMENT_REPOSITORY_TOKEN, SHIPMENT_DISPATCH_SERVICE_TOKEN],
})
export class ShippingModule {}
