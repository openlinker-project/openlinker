/**
 * PrestaShop Integration Module
 *
 * NestJS module for PrestaShop integration. Registers the PrestaShop adapter factory
 * with AdapterFactoryResolverService on module initialization.
 *
 * @module libs/integrations/prestashop/src
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { IntegrationsModule, ADAPTER_FACTORY_RESOLVER_TOKEN } from '@openlinker/core/integrations';
import { Inject } from '@nestjs/common';
import { AdapterFactoryResolverService } from '@openlinker/core/integrations/infrastructure/adapters/adapter-factory-resolver.service';
import { PrestashopAdapterFactoryWrapper } from './infrastructure/adapters/prestashop-adapter-factory-wrapper';
import { Logger } from '@openlinker/shared/logging';

@Module({
  imports: [IntegrationsModule],
})
export class PrestashopIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(PrestashopIntegrationModule.name);

  constructor(
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
    private readonly factoryResolver: AdapterFactoryResolverService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering PrestaShop adapter factory...');
    const factory = new PrestashopAdapterFactoryWrapper();
    this.factoryResolver.registerFactory('prestashop.webservice.v1', factory);
    this.logger.log('PrestaShop adapter factory registered successfully');
  }
}

