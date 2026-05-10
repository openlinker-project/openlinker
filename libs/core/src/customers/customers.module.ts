/**
 * Customers Module
 *
 * NestJS module for customer identity resolution and projection management.
 * Provides customer identity resolution service, customer projection service,
 * and repository implementations.
 *
 * @module libs/core/src/customers
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerProjectionOrmEntity } from './infrastructure/persistence/entities/customer-projection.orm-entity';
import { CustomerAddressProjectionOrmEntity } from './infrastructure/persistence/entities/customer-address-projection.orm-entity';
import { DestinationAddressMappingOrmEntity } from './infrastructure/persistence/entities/destination-address-mapping.orm-entity';
import { CustomerProjectionRepository } from './infrastructure/persistence/repositories/customer-projection.repository';
import { CustomerProjectionService } from './application/services/customer-projection.service';
import { CustomerIdentityResolverService } from './application/services/customer-identity-resolver.service';
import { OrderCustomerProjectionUpdaterService } from './application/services/order-customer-projection-updater.service';
import {
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
  CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN,
  ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN,
} from './customers.tokens';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule } from '@openlinker/core/integrations';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerProjectionOrmEntity,
      CustomerAddressProjectionOrmEntity,
      DestinationAddressMappingOrmEntity,
    ]),
    IdentifierMappingModule,
    // For EMAIL_NORMALIZER_REGISTRY_TOKEN + INTEGRATIONS_SERVICE_TOKEN
    // used by CustomerIdentityResolverService to dispatch email
    // normalization per source-adapter (#585 / E5).
    IntegrationsModule,
  ],
  providers: [
    // Provide classes directly first
    CustomerProjectionRepository,
    CustomerProjectionService,
    CustomerIdentityResolverService,
    OrderCustomerProjectionUpdaterService,
    // Then provide token bindings using useExisting
    {
      provide: CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
      useExisting: CustomerProjectionRepository,
    },
    {
      provide: CUSTOMER_PROJECTION_SERVICE_TOKEN,
      useExisting: CustomerProjectionService,
    },
    {
      provide: CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
      useExisting: CustomerIdentityResolverService,
    },
    {
      provide: CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN,
      useExisting: CustomerIdentityResolverService,
    },
    {
      provide: ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN,
      useExisting: OrderCustomerProjectionUpdaterService,
    },
  ],
  exports: [
    CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
    CUSTOMER_PROJECTION_SERVICE_TOKEN,
    CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
    CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN,
    ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN,
  ],
})
export class CustomersModule {}
