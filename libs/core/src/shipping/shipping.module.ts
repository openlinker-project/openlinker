/**
 * Shipping Module
 *
 * NestJS module for the shipping bounded context. Registers
 * `ShipmentOrmEntity` privately (via `TypeOrmModule.forFeature`) and binds
 * the concrete `ShipmentRepository` to `SHIPMENT_REPOSITORY_TOKEN`.
 *
 * Exports ONLY the port binding — does NOT re-export
 * `TypeOrmModule.forFeature(...)` because consumers inject via the
 * Symbol token (`@Inject(SHIPMENT_REPOSITORY_TOKEN)`) and never see
 * `Repository<ShipmentOrmEntity>` directly. Keeping the ORM type private
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

import { ShipmentOrmEntity } from './infrastructure/persistence/entities/shipment.orm-entity';
import { ShipmentRepository } from './infrastructure/persistence/repositories/shipment.repository';
import { SHIPMENT_REPOSITORY_TOKEN } from './shipping.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([ShipmentOrmEntity])],
  providers: [
    ShipmentRepository,
    {
      provide: SHIPMENT_REPOSITORY_TOKEN,
      useExisting: ShipmentRepository,
    },
  ],
  exports: [SHIPMENT_REPOSITORY_TOKEN],
})
export class ShippingModule {}
