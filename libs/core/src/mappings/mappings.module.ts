/**
 * Mappings Module
 *
 * NestJS module for the connection-scoped mapping configuration bounded context.
 * Registers ORM entities, repositories, the MappingConfigService, and the
 * fulfillment-routing model (#832).
 * Exports MAPPING_CONFIG_SERVICE_TOKEN + FULFILLMENT_ROUTING_SERVICE_TOKEN for
 * use in other modules (e.g., OrdersModule).
 *
 * @module libs/core/src/mappings
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { StatusMappingOrmEntity } from './infrastructure/persistence/entities/status-mapping.orm-entity';
import { CarrierMappingOrmEntity } from './infrastructure/persistence/entities/carrier-mapping.orm-entity';
import { PaymentMappingOrmEntity } from './infrastructure/persistence/entities/payment-mapping.orm-entity';
import { CategoryMappingOrmEntity } from './infrastructure/persistence/entities/category-mapping.orm-entity';
import { OrderStateMappingOrmEntity } from './infrastructure/persistence/entities/order-state-mapping.orm-entity';
import { FulfillmentRoutingRuleOrmEntity } from './infrastructure/persistence/entities/fulfillment-routing-rule.orm-entity';
import { StatusMappingRepository } from './infrastructure/persistence/repositories/status-mapping.repository';
import { CarrierMappingRepository } from './infrastructure/persistence/repositories/carrier-mapping.repository';
import { PaymentMappingRepository } from './infrastructure/persistence/repositories/payment-mapping.repository';
import { CategoryMappingRepository } from './infrastructure/persistence/repositories/category-mapping.repository';
import { OrderStateMappingRepository } from './infrastructure/persistence/repositories/order-state-mapping.repository';
import { FulfillmentRoutingRepository } from './infrastructure/persistence/repositories/fulfillment-routing.repository';
import { MappingConfigService } from './application/services/mapping-config.service';
import { FulfillmentRoutingService } from './application/services/fulfillment-routing.service';
import {
  MAPPING_CONFIG_SERVICE_TOKEN,
  STATUS_MAPPING_REPOSITORY_TOKEN,
  CARRIER_MAPPING_REPOSITORY_TOKEN,
  PAYMENT_MAPPING_REPOSITORY_TOKEN,
  CATEGORY_MAPPING_REPOSITORY_TOKEN,
  ORDER_STATE_MAPPING_REPOSITORY_TOKEN,
  FULFILLMENT_ROUTING_REPOSITORY_TOKEN,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
} from './mappings.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StatusMappingOrmEntity,
      CarrierMappingOrmEntity,
      PaymentMappingOrmEntity,
      CategoryMappingOrmEntity,
      OrderStateMappingOrmEntity,
      FulfillmentRoutingRuleOrmEntity,
    ]),
    IntegrationsModule,
    // Provides CONNECTION_PORT_TOKEN — FulfillmentRoutingService enumerates
    // active connections for getCandidateProcessors (#836). IntegrationsModule
    // imports IdentifierMappingModule but does not re-export the token.
    IdentifierMappingModule,
  ],
  providers: [
    StatusMappingRepository,
    CarrierMappingRepository,
    PaymentMappingRepository,
    CategoryMappingRepository,
    OrderStateMappingRepository,
    FulfillmentRoutingRepository,
    MappingConfigService,
    FulfillmentRoutingService,
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
      provide: CATEGORY_MAPPING_REPOSITORY_TOKEN,
      useExisting: CategoryMappingRepository,
    },
    {
      provide: ORDER_STATE_MAPPING_REPOSITORY_TOKEN,
      useExisting: OrderStateMappingRepository,
    },
    {
      provide: FULFILLMENT_ROUTING_REPOSITORY_TOKEN,
      useExisting: FulfillmentRoutingRepository,
    },
    {
      provide: MAPPING_CONFIG_SERVICE_TOKEN,
      useExisting: MappingConfigService,
    },
    {
      provide: FULFILLMENT_ROUTING_SERVICE_TOKEN,
      useExisting: FulfillmentRoutingService,
    },
  ],
  exports: [
    MAPPING_CONFIG_SERVICE_TOKEN,
    MappingConfigService,
    FULFILLMENT_ROUTING_SERVICE_TOKEN,
  ],
})
export class MappingsModule {}
