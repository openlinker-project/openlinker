/**
 * PrestaShop Integration Module
 *
 * NestJS module for PrestaShop integration. Registers the PrestaShop adapter factory
 * with AdapterFactoryResolverService on module initialization.
 *
 * @module libs/integrations/prestashop/src
 */
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import {
  IntegrationsModule,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  AdapterFactoryResolverService,
  ADAPTER_REGISTRY_TOKEN,
  AdapterRegistryPort,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  ConnectionTesterRegistryService,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  WebhookSecretProviderPort,
} from '@openlinker/core/integrations';
import {
  MappingsModule,
  MAPPING_CONFIG_SERVICE_TOKEN,
  IMappingConfigService,
} from '@openlinker/core/mappings';
import { PrestashopAdapterFactoryWrapper } from './infrastructure/adapters/prestashop-adapter-factory-wrapper';
import { PrestashopConnectionTesterAdapter } from './infrastructure/adapters/prestashop-connection-tester.adapter';
import { PrestashopCustomerProvisioner } from './infrastructure/provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from './infrastructure/provisioners/prestashop-address-provisioner';
import { PrestashopCountryResolver } from './infrastructure/provisioners/prestashop-country-resolver';
import { PrestashopWebhookProvisioningService } from './application/services/prestashop-webhook-provisioning.service';
import { PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN } from './application/interfaces/prestashop-webhook-provisioning.service.interface';
import {
  CustomersModule,
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { Logger } from '@openlinker/shared/logging';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule, CustomersModule, RedisConfigModule, MappingsModule],
  providers: [
    PrestashopCustomerProvisioner,
    PrestashopAddressProvisioner,
    PrestashopCountryResolver,
    PrestashopWebhookProvisioningService,
    {
      provide: PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN,
      useExisting: PrestashopWebhookProvisioningService,
    },
  ],
  exports: [
    PRESTASHOP_WEBHOOK_PROVISIONING_SERVICE_TOKEN,
  ],
})
export class PrestashopIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(PrestashopIntegrationModule.name);

  constructor(
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort,
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
    private readonly factoryResolver: AdapterFactoryResolverService,
    @Inject(CONNECTION_TESTER_REGISTRY_TOKEN)
    private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
    private readonly customerProvisioner: PrestashopCustomerProvisioner,
    private readonly addressProvisioner: PrestashopAddressProvisioner,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly webhookSecretProvider: WebhookSecretProviderPort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering PrestaShop adapter (metadata + factory + tester)...');
    // Register metadata first — what this adapter is and what it can do.
    // Mirrors the inline literal previously hardcoded in core's
    // AdapterRegistryService (#570). isDefault: true means
    // `IntegrationsService` resolves connections without an explicit
    // adapterKey to this adapter for the 'prestashop' platformType (#571).
    this.adapterRegistry.register({
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      supportedCapabilities: [
        'ProductMaster',
        'InventoryMaster',
        'OrderSource',
        'OrderProcessorManager',
      ],
      displayName: 'PrestaShop WebService v1',
      version: '1.0.0',
      isDefault: true,
    });
    // Then the factory + connection tester — runtime instantiation surface.
    const factory = new PrestashopAdapterFactoryWrapper(
      this.customerProvisioner,
      this.addressProvisioner,
      this.customerProjectionRepository,
      this.mappingConfigService,
      this.webhookSecretProvider,
    );
    this.factoryResolver.registerFactory('prestashop.webservice.v1', factory);
    this.connectionTesterRegistry.register(
      'prestashop.webservice.v1',
      new PrestashopConnectionTesterAdapter(),
    );
    this.logger.log('PrestaShop adapter registered successfully');
  }
}



