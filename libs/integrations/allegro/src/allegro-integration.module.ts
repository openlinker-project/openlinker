/**
 * Allegro Integration Module
 *
 * NestJS module for Allegro integration. Registers the Allegro adapter factory
 * with AdapterFactoryResolverService on module initialization. Also provides
 * command status repository for observability.
 *
 * @module libs/integrations/allegro/src
 */
import { Module, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  IntegrationCredentialRepositoryPort,
} from '@openlinker/core/integrations';
// New cross-package import (#581): the retry-classifier registry lives in
// `@openlinker/core/sync` (the runner's package). Architecturally fine —
// integrations may depend on core — and mirrors how this module already
// depends on `@openlinker/core/integrations`. The `SyncModule` import
// below is what brings `RETRY_CLASSIFIER_REGISTRY_TOKEN` into DI scope;
// without it Nest can't resolve the constructor argument when the host
// (apps/api or apps/worker) boots, because tokens flow only through
// `imports`/`exports`, never via direct package imports.
import {
  SyncModule,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  RetryClassifierRegistryService,
} from '@openlinker/core/sync';
import { AllegroConnectionTesterAdapter } from './infrastructure/adapters/allegro-connection-tester.adapter';
import { AllegroEmailNormalizerAdapter } from './infrastructure/adapters/allegro-email-normalizer.adapter';
import { AllegroRetryClassifierAdapter } from './infrastructure/adapters/allegro-retry-classifier.adapter';
import { RedisClientType } from 'redis';
import { CustomersModule, CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN, CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { AllegroAdapterFactoryWrapper } from './infrastructure/adapters/allegro-adapter-factory-wrapper';
import { AllegroQuantityCommandOrmEntity } from './infrastructure/persistence/entities/allegro-quantity-command.orm-entity';
import { AllegroQuantityCommandRepository } from './infrastructure/persistence/repositories/allegro-quantity-command.repository';
import { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
import { ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN } from './allegro.tokens';
import { Logger } from '@openlinker/shared/logging';
import { AllegroQuantityCommandRepositoryPort } from './domain/ports/allegro-quantity-command-repository.port';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';

@Module({
  imports: [
    IntegrationsModule,
    SyncModule, // Brings RETRY_CLASSIFIER_REGISTRY_TOKEN into DI scope (#581)
    CustomersModule, // Import CustomersModule to access CustomerIdentityResolverPort
    TypeOrmModule.forFeature([AllegroQuantityCommandOrmEntity]),
  ],
  providers: [
    // Provide class directly first
    AllegroQuantityCommandRepository,
    // Then provide token binding using useExisting
    {
      provide: ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
      useExisting: AllegroQuantityCommandRepository,
    },
    // Also provide as string token for convenience
    {
      provide: 'AllegroQuantityCommandRepositoryPort',
      useExisting: ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
    },
    // Token refresh service (optional dependencies - works without Redis/credential repository)
    // Note: Dependencies may be undefined if not available, which is handled by the service
    {
      provide: AllegroTokenRefreshService,
      useFactory: (
        redisClient?: RedisClientType,
        credentialRepository?: IntegrationCredentialRepositoryPort,
      ): AllegroTokenRefreshService => {
        return new AllegroTokenRefreshService(redisClient, credentialRepository);
      },
      inject: ['REDIS_CLIENT', INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN],
    },
  ],
  exports: [
    ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
    'AllegroQuantityCommandRepositoryPort',
  ],
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
    @Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)
    private readonly retryClassifierRegistry: RetryClassifierRegistryService,
    @Inject(CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN)
    private readonly customerIdentityResolver: CustomerIdentityResolverPort,
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
     * `CacheModule` keep working — production wiring imports it via
     * `apps/api/src/app.module.ts`.
     */
    @Optional()
    @Inject(CACHE_PORT_TOKEN)
    private readonly cache?: CachePort,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'Registering Allegro adapter (metadata + factory + tester + email normalizer + retry classifier)...',
    );
    // Register metadata first — what this adapter is and what it can do.
    // Mirrors the inline literal previously hardcoded in core's
    // AdapterRegistryService (#570). isDefault: true means
    // `IntegrationsService` resolves connections without an explicit
    // adapterKey to this adapter for the 'allegro' platformType (#571).
    this.adapterRegistry.register({
      adapterKey: 'allegro.publicapi.v1',
      platformType: 'allegro',
      supportedCapabilities: ['OrderSource', 'OfferManager'],
      displayName: 'Allegro Public API v1',
      version: '1.0.0',
      isDefault: true,
    });
    // Then the factory + connection tester — runtime instantiation surface.
    const factory = new AllegroAdapterFactoryWrapper(
      this.customerIdentityResolver,
      this.tokenRefreshService,
      this.commandRepository,
      this.readQuantityPollConfig(),
      this.cache,
      this.readCatParamsTtlSec(),
    );
    this.factoryResolver.registerFactory('allegro.publicapi.v1', factory);
    this.connectionTesterRegistry.register(
      'allegro.publicapi.v1',
      new AllegroConnectionTesterAdapter(),
    );
    // Email normalizer — strips Allegro's masked-email `+transactionId`
    // suffix so customer-identity emailHash dedup remains stable across
    // orders from the same buyer (#585 / E5). Previously hardcoded inside
    // `@openlinker/shared/config::normalizeEmail`; now dispatched via the
    // EmailNormalizerRegistry like the sister cross-cutting registries.
    this.emailNormalizerRegistry.register(
      'allegro.publicapi.v1',
      new AllegroEmailNormalizerAdapter(),
    );
    // Retry classifier — replaces the runner's hardcoded `instanceof
    // AllegroApiException` / `AllegroAuthenticationException` sniffing
    // (#581). The classifier owns Allegro's exception hierarchy; the
    // runner asks the registry "is this non-retryable?" without importing
    // platform-specific classes.
    this.retryClassifierRegistry.register(
      'allegro.publicapi.v1',
      new AllegroRetryClassifierAdapter(),
    );
    this.logger.log('Allegro adapter registered successfully');
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

