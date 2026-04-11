/**
 * Mappings Module
 *
 * NestJS module for the connection-scoped mapping configuration bounded context.
 * Registers ORM entities, repositories, and the MappingConfigService.
 * Exports MAPPING_CONFIG_SERVICE_TOKEN for use in other modules (e.g., OrdersModule).
 *
 * @module libs/core/src/mappings
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatusMappingOrmEntity } from './infrastructure/persistence/entities/status-mapping.orm-entity';
import { CarrierMappingOrmEntity } from './infrastructure/persistence/entities/carrier-mapping.orm-entity';
import { PaymentMappingOrmEntity } from './infrastructure/persistence/entities/payment-mapping.orm-entity';
import { StatusMappingRepository } from './infrastructure/persistence/repositories/status-mapping.repository';
import { CarrierMappingRepository } from './infrastructure/persistence/repositories/carrier-mapping.repository';
import { PaymentMappingRepository } from './infrastructure/persistence/repositories/payment-mapping.repository';
import { MappingConfigService } from './application/services/mapping-config.service';
import {
  MAPPING_CONFIG_SERVICE_TOKEN,
  STATUS_MAPPING_REPOSITORY_TOKEN,
  CARRIER_MAPPING_REPOSITORY_TOKEN,
  PAYMENT_MAPPING_REPOSITORY_TOKEN,
} from './mappings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StatusMappingOrmEntity,
      CarrierMappingOrmEntity,
      PaymentMappingOrmEntity,
    ]),
  ],
  providers: [
    StatusMappingRepository,
    CarrierMappingRepository,
    PaymentMappingRepository,
    MappingConfigService,
    {
      provide: STATUS_MAPPING_REPOSITORY_TOKEN,
      useExisting: StatusMappingRepository,
    },
    {
      provide: CARRIER_MAPPING_REPOSITORY_TOKEN,
      useExisting: CarrierMappingRepository,
    },
    {
      provide: PAYMENT_MAPPING_REPOSITORY_TOKEN,
      useExisting: PaymentMappingRepository,
    },
    {
      provide: MAPPING_CONFIG_SERVICE_TOKEN,
      useExisting: MappingConfigService,
    },
  ],
  exports: [
    MAPPING_CONFIG_SERVICE_TOKEN,
    MappingConfigService,
  ],
})
export class MappingsModule {}
