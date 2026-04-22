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
import { IntegrationsModule, ADAPTER_FACTORY_RESOLVER_TOKEN, AdapterFactoryResolverService, CONNECTION_TESTER_REGISTRY_TOKEN, ConnectionTesterRegistryService, INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN, IntegrationCredentialRepositoryPort } from '@openlinker/core/integrations';
import { AllegroConnectionTesterAdapter } from './infrastructure/adapters/allegro-connection-tester.adapter';
import { RedisClientType } from 'redis';
import { CustomersModule, CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN, CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { AllegroAdapterFactoryWrapper } from './infrastructure/adapters/allegro-adapter-factory-wrapper';
import { AllegroQuantityCommandOrmEntity } from './infrastructure/persistence/entities/allegro-quantity-command.orm-entity';
import { AllegroQuantityCommandRepository } from './infrastructure/persistence/repositories/allegro-quantity-command.repository';
import { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
import { ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN } from './allegro.tokens';
import { Logger } from '@openlinker/shared/logging';
import { AllegroQuantityCommandRepositoryPort } from './domain/ports/allegro-quantity-command-repository.port';

@Module({
  imports: [
    IntegrationsModule,
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
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
    private readonly factoryResolver: AdapterFactoryResolverService,
    @Inject(CONNECTION_TESTER_REGISTRY_TOKEN)
    private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
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
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering Allegro adapter factory...');
    const factory = new AllegroAdapterFactoryWrapper(
      this.customerIdentityResolver,
      this.tokenRefreshService,
      this.commandRepository,
      this.readQuantityPollConfig(),
    );
    this.factoryResolver.registerFactory('allegro.publicapi.v1', factory);
    this.connectionTesterRegistry.register(
      'allegro.publicapi.v1',
      new AllegroConnectionTesterAdapter(),
    );
    this.logger.log('Allegro adapter factory registered successfully');
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
}

