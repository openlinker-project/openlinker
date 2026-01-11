/**
 * PrestaShop Integration Module
 *
 * NestJS module for PrestaShop integration. Registers the PrestaShop adapter factory
 * with AdapterFactoryResolverService on module initialization.
 *
 * @module libs/integrations/prestashop/src
 */
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { IntegrationsModule, ADAPTER_FACTORY_RESOLVER_TOKEN, AdapterFactoryResolverService } from '@openlinker/core/integrations';
import { PrestashopAdapterFactoryWrapper } from './infrastructure/adapters/prestashop-adapter-factory-wrapper';
import { PrestashopCustomerProvisioner } from './infrastructure/provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from './infrastructure/provisioners/prestashop-address-provisioner';
import { PrestashopCountryResolver } from './infrastructure/provisioners/prestashop-country-resolver';
import {
  CustomersModule,
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { Logger } from '@openlinker/shared/logging';

@Module({
  imports: [IntegrationsModule, CustomersModule, RedisConfigModule],
  providers: [PrestashopCustomerProvisioner, PrestashopAddressProvisioner, PrestashopCountryResolver],
})
export class PrestashopIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(PrestashopIntegrationModule.name);

  constructor(
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
    private readonly factoryResolver: AdapterFactoryResolverService,
    private readonly customerProvisioner: PrestashopCustomerProvisioner,
    private readonly addressProvisioner: PrestashopAddressProvisioner,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering PrestaShop adapter factory...');
    const factory = new PrestashopAdapterFactoryWrapper(
      this.customerProvisioner,
      this.addressProvisioner,
      this.customerProjectionRepository,
    );
    this.factoryResolver.registerFactory('prestashop.webservice.v1', factory);
    this.logger.log('PrestaShop adapter factory registered successfully');
  }
}



