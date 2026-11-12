/**
 * Shopify Integration Module
 *
 * Host wiring for the Shopify plugin. Hand-written rather than built with
 * `createNestAdapterModule`, because two pieces need Nest-provided
 * collaborators the `HostServices` bag does not carry:
 *   - the OAuth token write-back: Shopify rotates the refresh token on every
 *     refresh, so the plugin's runtime gets a credentials writer (over
 *     `ICredentialsService`) and the host `SyncLockPort`;
 *   - the archive hook, registered on `ConnectionArchiveHookRegistryService`,
 *     which drops the minted token when a connection is archived (K05).
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/shopify/src
 */
import type { OnModuleInit } from '@nestjs/common';
import { Inject, Module } from '@nestjs/common';
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
  CONNECTION_ARCHIVE_HOOK_REGISTRY_TOKEN,
  ConnectionArchiveHookRegistryService,
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
  CREDENTIALS_SERVICE_TOKEN,
  ICredentialsService,
} from '@openlinker/core/integrations';
import {
  SyncModule,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  RetryClassifierRegistryService,
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
  AuthFailureClassifierRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SchedulerTaskRegistryService,
  SYNC_LOCK_TOKEN,
  SyncLockPort,
} from '@openlinker/core/sync';
import {
  MappingsModule,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type IMappingConfigService,
} from '@openlinker/core/mappings';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HostServices } from '@openlinker/plugin-sdk';
import { RateLimitModule, HTTP_TRANSPORT_FACTORY_TOKEN } from '@openlinker/plugin-sdk';
import { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { ShopifyConnectionArchiveHookAdapter } from './infrastructure/adapters/shopify-connection-archive-hook.adapter';
import { ShopifyCredentialsWriterAdapter } from './infrastructure/adapters/shopify-credentials-writer.adapter';
import { createShopifyClientRuntime } from './infrastructure/http/shopify-client.builder';
import { createShopifyPlugin } from './shopify-plugin';

@Module({
  imports: [IntegrationsModule, SyncModule, IdentifierMappingModule, MappingsModule, RateLimitModule],
})
export class ShopifyIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(ShopifyIntegrationModule.name);

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
    @Inject(CONNECTION_ARCHIVE_HOOK_REGISTRY_TOKEN)
    private readonly connectionArchiveHookRegistry: ConnectionArchiveHookRegistryService,
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
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentialsService: ICredentialsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(HTTP_TRANSPORT_FACTORY_TOKEN)
    private readonly http: HttpTransportFactoryPort,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort,
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering Shopify plugin (manifest + factory + side registries)...');

    const runtime = createShopifyClientRuntime({
      credentialsWriter: new ShopifyCredentialsWriterAdapter(this.credentialsService),
      lock: this.syncLock,
    });
    const plugin = createShopifyPlugin({ runtime, mappingConfigService: this.mappingConfigService });

    const host: HostServices = {
      logger: (context: string) => new Logger(context),
      identifierMapping: this.identifierMapping,
      credentialsResolver: this.credentialsResolver,
      http: this.http,
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

    this.connectionArchiveHookRegistry.register(
      plugin.manifest.adapterKey,
      new ShopifyConnectionArchiveHookAdapter(this.cache, runtime.tokenMemo),
    );

    this.logger.log('Shopify plugin registered successfully');
  }
}
