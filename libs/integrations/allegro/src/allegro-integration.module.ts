/**
 * Allegro Integration Module
 *
 * NestJS host wrapper for the Allegro plugin descriptor (`createAllegroPlugin`).
 * Holds the Nest-specific surface — providers (`AllegroQuantityCommandRepository`,
 * `AllegroTokenRefreshService`), imports (`TypeOrmModule.forFeature`,
 * `CustomersModule`, `IntegrationsModule`, `SyncModule`), token bindings —
 * that the framework-neutral descriptor can't own. The `onModuleInit` body
 * builds the descriptor and a `HostServices` bag from injected fields, then
 * routes registration through the descriptor (#593 / Shape A).
 *
 * @module libs/integrations/allegro/src
 */
import type { OnModuleInit } from '@nestjs/common';
import { Module, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type {
  ICredentialsService,
  AdapterFactoryPort,
} from '@openlinker/core/integrations';
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
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN,
  OAuthCompletionRegistryService,
  CREDENTIALS_SERVICE_TOKEN,
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
  CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN,
  CustomerIdentityResolverPort,
} from '@openlinker/core/customers';
import {
  IdentifierMappingModule,
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IdentifierMappingPort,
  type Connection,
} from '@openlinker/core/identifier-mapping';
import type { RedisClientType } from 'redis';
import { Logger } from '@openlinker/shared/logging';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HostServices } from '@openlinker/plugin-sdk';
import { AllegroQuantityCommandOrmEntity } from './infrastructure/persistence/entities/allegro-quantity-command.orm-entity';
import { AllegroQuantityCommandRepository } from './infrastructure/persistence/repositories/allegro-quantity-command.repository';
import { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
import { ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN } from './allegro.tokens';
import { AllegroQuantityCommandRepositoryPort } from './domain/ports/allegro-quantity-command-repository.port';
import { createAllegroPlugin } from './allegro-plugin';

@Module({
  imports: [
    IntegrationsModule,
    SyncModule, // Brings RETRY_CLASSIFIER_REGISTRY_TOKEN into DI scope (#581)
    IdentifierMappingModule, // Brings IDENTIFIER_MAPPING_PORT_TOKEN into DI scope (#593)
    CustomersModule, // Access CustomerIdentityResolverPort
    TypeOrmModule.forFeature([AllegroQuantityCommandOrmEntity]),
  ],
  providers: [
    AllegroQuantityCommandRepository,
    {
      provide: ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
      useExisting: AllegroQuantityCommandRepository,
    },
    {
      provide: 'AllegroQuantityCommandRepositoryPort',
      useExisting: ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
    },
    // Token refresh service — optional Redis/credentials deps tolerated by the service.
    {
      provide: AllegroTokenRefreshService,
      useFactory: (
        redisClient?: RedisClientType,
        credentials?: ICredentialsService
      ): AllegroTokenRefreshService =>
        new AllegroTokenRefreshService(redisClient, credentials),
      inject: ['REDIS_CLIENT', CREDENTIALS_SERVICE_TOKEN],
    },
  ],
  exports: [ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN, 'AllegroQuantityCommandRepositoryPort'],
})
export class AllegroIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(AllegroIntegrationModule.name);

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
    @Inject(CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN)
    private readonly customerIdentityResolver: CustomerIdentityResolverPort,
    @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
    @Optional()
    @Inject(AllegroTokenRefreshService)
    private readonly tokenRefreshService?: AllegroTokenRefreshService,
    @Optional()
    @Inject(ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN)
    private readonly commandRepository?: AllegroQuantityCommandRepositoryPort,
    @Optional()
    private readonly configService?: ConfigService,
    /**
     * Distributed cache used by the offer-manager adapter for category-parameter
     * responses (#410). Optional so unit-test bootstraps that don't import
     * `CacheModule` keep working.
     */
    @Optional()
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering Allegro plugin (manifest + factory + side registries)...');

    // Build the descriptor from plugin-specific deps.
    const plugin = createAllegroPlugin({
      customerIdentityResolver: this.customerIdentityResolver,
      tokenRefreshService: this.tokenRefreshService,
      commandRepository: this.commandRepository,
      configService: this.configService,
      quantityPollConfig: this.readQuantityPollConfig(),
      catParamsTtlSec: this.readCatParamsTtlSec(),
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
      connectionConfigShapeValidatorRegistry: this.connectionConfigShapeValidatorRegistry,
      connectionCredentialsShapeValidatorRegistry: this.connectionCredentialsShapeValidatorRegistry,
      oauthCompletionRegistry: this.oauthCompletionRegistry,
    };

    // The three registration lines.
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

    this.logger.log('Allegro plugin registered successfully');
  }

  private readQuantityPollConfig(): Record<string, number> | undefined {
    if (!this.configService) {
      return undefined;
    }
    const parseInt = (key: string): number | undefined => {
      const raw = this.configService?.get<string>(key);
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const config: Record<string, number> = {};
    const maxAttempts = parseInt('OL_ALLEGRO_QUANTITY_POLL_MAX_ATTEMPTS');
    const initialDelayMs = parseInt('OL_ALLEGRO_QUANTITY_POLL_INITIAL_DELAY_MS');
    const maxDelayMs = parseInt('OL_ALLEGRO_QUANTITY_POLL_MAX_DELAY_MS');
    const backoffMultiplier = parseInt('OL_ALLEGRO_QUANTITY_POLL_BACKOFF_MULTIPLIER');
    if (maxAttempts !== undefined) config.maxAttempts = maxAttempts;
    if (initialDelayMs !== undefined) config.initialDelayMs = initialDelayMs;
    if (maxDelayMs !== undefined) config.maxDelayMs = maxDelayMs;
    if (backoffMultiplier !== undefined) config.backoffMultiplier = backoffMultiplier;
    return Object.keys(config).length > 0 ? config : undefined;
  }

  /**
   * Read the cache-TTL override for `/sale/categories/{id}/parameters` from
   * `OL_ALLEGRO_CAT_PARAMS_TTL_SEC`. Returns `undefined` when unset or
   * non-positive — the adapter then uses its 24h default.
   */
  private readCatParamsTtlSec(): number | undefined {
    const raw = this.configService?.get<string>('OL_ALLEGRO_CAT_PARAMS_TTL_SEC');
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}
