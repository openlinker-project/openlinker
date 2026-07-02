/**
 * Erli Integration Module
 *
 * Host wiring for the Erli Shop API v1 plugin. Converted from
 * `createNestAdapterModule` to a full custom `@Module` class (#1198) to
 * support injecting `INVENTORY_QUERY_SERVICE_TOKEN` from the DI container for
 * the `OrderStatusWriteback` `cancelled` stock-restore path (#1198 / #997).
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as the
 * single edit point that enables the plugin in both hosts.
 *
 * @module libs/integrations/erli/src
 */
import type { OnModuleInit } from '@nestjs/common';
import { Module, Inject, Optional } from '@nestjs/common';
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
  IdentifierMappingModule,
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IdentifierMappingPort,
  type Connection,
} from '@openlinker/core/identifier-mapping';
import {
  InventoryModule,
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createErliPlugin } from './erli-plugin';
import { ErliWebhookProvisioningModule } from './erli-webhook-provisioning.module';

@Module({
  imports: [
    IntegrationsModule,
    SyncModule,
    IdentifierMappingModule,
    InventoryModule,
    // #996: the automated webhook provisioner needs NestJS-injected ConnectionPort
    // + IWebhookSecretService (not in HostServices), so it self-registers from
    // this companion module rather than from plugin.register(host).
    ErliWebhookProvisioningModule,
  ],
})
export class ErliIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(ErliIntegrationModule.name);

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
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Optional()
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering Erli plugin (manifest + factory + side registries)...');

    const plugin = createErliPlugin({ inventoryQuery: this.inventoryQuery });

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

    this.logger.log('Erli plugin registered successfully');
  }
}
