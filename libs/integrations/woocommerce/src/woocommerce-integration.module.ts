/**
 * WooCommerce Integration Module
 *
 * NestJS host wrapper for the WooCommerce plugin descriptor
 * (`createWooCommercePlugin`). WooCommerce's customer + address provisioners
 * (#1552) depend on the host `SyncLockPort` and `CustomerProjectionRepositoryPort`,
 * which are NOT part of the curated `HostServices` bag — so the plugin can no
 * longer be wired with the bare `createNestAdapterModule` helper. This module
 * mirrors the PrestaShop pattern (Shape A, #593): it provides the provisioners,
 * builds the descriptor with those plugin-specific deps in `onModuleInit`,
 * assembles a `HostServices` bag from injected host fields, and routes manifest
 * + factory + side registrations through the descriptor.
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as the
 * single edit point that enables the plugin in both hosts.
 *
 * @module libs/integrations/woocommerce/src
 */
import type { OnModuleInit } from '@nestjs/common';
import { Module, Inject } from '@nestjs/common';
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
  INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN,
  InboundWebhookDecoderRegistryService,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN,
  ConnectionCredentialsRewriterRegistryService,
  INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN,
  OAuthCompletionRegistryService,
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
  CustomersModule,
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjectionRepositoryPort,
} from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HostServices } from '@openlinker/plugin-sdk';
import { WooCommerceCustomerProvisioner } from './infrastructure/provisioners/woocommerce-customer-provisioner';
import { WooCommerceAddressProvisioner } from './infrastructure/provisioners/woocommerce-address-provisioner';
import { createWooCommercePlugin } from './woocommerce-plugin';
import { WooCommerceWebhookProvisioningModule } from './woocommerce-webhook-provisioning.module';

@Module({
  imports: [
    IntegrationsModule,
    SyncModule,
    IdentifierMappingModule,
    CustomersModule,
    // The inbound webhook provisioner (#1548) needs NestJS-injected ConnectionPort
    // + IWebhookSecretService (not in the HostServices bag), so it self-registers
    // from this companion module rather than from plugin.register(host).
    WooCommerceWebhookProvisioningModule,
  ],
  providers: [WooCommerceCustomerProvisioner, WooCommerceAddressProvisioner],
})
export class WooCommerceIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(WooCommerceIntegrationModule.name);

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
    @Inject(INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN)
    private readonly inboundWebhookDecoderRegistry: InboundWebhookDecoderRegistryService,
    @Inject(CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionConfigShapeValidatorRegistry: ConnectionConfigShapeValidatorRegistryService,
    @Inject(CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionCredentialsShapeValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService,
    @Inject(CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN)
    private readonly connectionCredentialsRewriterRegistry: ConnectionCredentialsRewriterRegistryService,
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
    private readonly customerProvisioner: WooCommerceCustomerProvisioner,
    private readonly addressProvisioner: WooCommerceAddressProvisioner,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering WooCommerce plugin (manifest + factory + side registries)...');

    const plugin = createWooCommercePlugin({
      customerProvisioner: this.customerProvisioner,
      addressProvisioner: this.addressProvisioner,
      customerProjectionRepository: this.customerProjectionRepository,
    });

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
      inboundWebhookDecoderRegistry: this.inboundWebhookDecoderRegistry,
      connectionConfigShapeValidatorRegistry: this.connectionConfigShapeValidatorRegistry,
      connectionCredentialsShapeValidatorRegistry: this.connectionCredentialsShapeValidatorRegistry,
      connectionCredentialsRewriterRegistry: this.connectionCredentialsRewriterRegistry,
      oauthCompletionRegistry: this.oauthCompletionRegistry,
    };

    host.adapterRegistry.register(plugin.manifest);
    const factoryAdapter: AdapterFactoryPort = {
      createCapabilityAdapter: <T>(
        conn: Connection,
        cap: string,
        idMap: IdentifierMappingPort,
        credRes: CredentialsResolverPort,
      ): Promise<T> =>
        plugin.createCapabilityAdapter<T>(conn, cap, {
          ...host,
          identifierMapping: idMap,
          credentialsResolver: credRes,
        }),
    };
    host.factoryResolver.registerFactory(plugin.manifest.adapterKey, factoryAdapter);
    plugin.register?.(host);

    this.logger.log('WooCommerce plugin registered successfully');
  }
}
