/**
 * PrestaShop Integration Module
 *
 * NestJS host wrapper for the PrestaShop plugin descriptor
 * (`createPrestashopPlugin`). Holds the Nest-specific surface — providers
 * (`PrestashopCustomerProvisioner`, `PrestashopAddressProvisioner`,
 * `PrestashopCountryResolver`, `PrestashopWebhookProvisioningAdapter`),
 * imports (`IntegrationsModule`, `CustomersModule`, `MappingsModule`,
 * `IdentifierMappingModule`, `RedisConfigModule`) — that the framework-
 * neutral descriptor can't own. The `onModuleInit` body builds the
 * descriptor + a `HostServices` bag from injected fields, then routes
 * registration through the descriptor (#593 / Shape A).
 *
 * @module libs/integrations/prestashop/src
 */
import type { OnModuleInit } from '@nestjs/common';
import { Module, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentifierMappingModule,
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IdentifierMappingPort,
  type Connection,
} from '@openlinker/core/identifier-mapping';
import type { AdapterFactoryPort } from '@openlinker/core/integrations';
import {
  IntegrationsModule,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  AdapterFactoryResolverService,
  ADAPTER_REGISTRY_TOKEN,
  AdapterRegistryPort,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  ConnectionTesterRegistryService,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  EmailNormalizerRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  WebhookProvisioningRegistryService,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  WebhookEventTranslatorRegistryService,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN,
  OAuthCompletionRegistryService,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  WebhookSecretProviderPort,
  CREDENTIALS_RESOLVER_TOKEN,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import {
  SyncModule,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  RetryClassifierRegistryService,
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
  AuthFailureClassifierRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SchedulerTaskRegistryService,
} from '@openlinker/core/sync';
import {
  MappingsModule,
  MAPPING_CONFIG_SERVICE_TOKEN,
  IMappingConfigService,
} from '@openlinker/core/mappings';
import {
  CustomersModule,
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HostServices } from '@openlinker/plugin-sdk';
import { PrestashopCustomerProvisioner } from './infrastructure/provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from './infrastructure/provisioners/prestashop-address-provisioner';
import { PrestashopCountryResolver } from './infrastructure/provisioners/prestashop-country-resolver';
import { PrestashopWebhookProvisioningAdapter } from './infrastructure/adapters/prestashop-webhook-provisioning.adapter';
import { createPrestashopPlugin } from './prestashop-plugin';

@Module({
  imports: [
    IntegrationsModule,
    SyncModule,
    IdentifierMappingModule,
    CustomersModule,
    RedisConfigModule,
    MappingsModule,
  ],
  providers: [
    PrestashopCustomerProvisioner,
    PrestashopAddressProvisioner,
    PrestashopCountryResolver,
    PrestashopWebhookProvisioningAdapter,
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
    @Inject(EMAIL_NORMALIZER_REGISTRY_TOKEN)
    private readonly emailNormalizerRegistry: EmailNormalizerRegistryService,
    @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
    private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
    @Inject(WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN)
    private readonly webhookEventTranslatorRegistry: WebhookEventTranslatorRegistryService,
    @Inject(CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionConfigShapeValidatorRegistry: ConnectionConfigShapeValidatorRegistryService,
    @Inject(CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionCredentialsShapeValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService,
    @Inject(INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN)
    private readonly oauthCompletionRegistry: OAuthCompletionRegistryService,
    @Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)
    private readonly retryClassifierRegistry: RetryClassifierRegistryService,
    @Inject(AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN)
    private readonly authFailureClassifierRegistry: AuthFailureClassifierRegistryService,
    @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
    private readonly schedulerTaskRegistry: SchedulerTaskRegistryService,
    @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly webhookProvisioningAdapter: PrestashopWebhookProvisioningAdapter,
    private readonly customerProvisioner: PrestashopCustomerProvisioner,
    private readonly addressProvisioner: PrestashopAddressProvisioner,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly webhookSecretProvider: WebhookSecretProviderPort,
    private readonly configService: ConfigService,
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering PrestaShop plugin (manifest + factory + side registries)...');

    // Build the descriptor from plugin-specific deps.
    const plugin = createPrestashopPlugin({
      customerProvisioner: this.customerProvisioner,
      addressProvisioner: this.addressProvisioner,
      customerProjectionRepository: this.customerProjectionRepository,
      mappingConfigService: this.mappingConfigService,
      webhookSecretProvider: this.webhookSecretProvider,
      webhookProvisioningAdapter: this.webhookProvisioningAdapter,
      configService: this.configService,
    });

    // Build the HostServices bag from injected host fields.
    const host: HostServices = {
      logger: (context: string) => new Logger(context),
      identifierMapping: this.identifierMapping,
      credentialsResolver: this.credentialsResolver,
      cache: this.cache,
      adapterRegistry: this.adapterRegistry,
      factoryResolver: this.factoryResolver,
      connectionTesterRegistry: this.connectionTesterRegistry,
      emailNormalizerRegistry: this.emailNormalizerRegistry,
      retryClassifierRegistry: this.retryClassifierRegistry,
      authFailureClassifierRegistry: this.authFailureClassifierRegistry,
      schedulerTaskRegistry: this.schedulerTaskRegistry,
      webhookProvisioningRegistry: this.webhookProvisioningRegistry,
      webhookEventTranslatorRegistry: this.webhookEventTranslatorRegistry,
      connectionConfigShapeValidatorRegistry: this.connectionConfigShapeValidatorRegistry,
      connectionCredentialsShapeValidatorRegistry: this.connectionCredentialsShapeValidatorRegistry,
      oauthCompletionRegistry: this.oauthCompletionRegistry,
    };

    host.adapterRegistry.register(plugin.manifest);
    const factoryAdapter: AdapterFactoryPort = {
      createCapabilityAdapter: <T>(
        conn: Connection,
        cap: string,
        idMap: IdentifierMappingPort,
        credRes: CredentialsResolverPort
      ): Promise<T> =>
        plugin.createCapabilityAdapter<T>(conn, cap, {
          ...host,
          identifierMapping: idMap,
          credentialsResolver: credRes,
        }),
    };
    host.factoryResolver.registerFactory(plugin.manifest.adapterKey, factoryAdapter);
    plugin.register?.(host);

    this.logger.log('PrestaShop plugin registered successfully');
  }
}
