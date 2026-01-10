/**
 * Allegro Integration Module
 *
 * NestJS module for Allegro integration. Registers the Allegro adapter factory
 * with AdapterFactoryResolverService on module initialization. Also provides
 * command status repository for observability.
 *
 * @module libs/integrations/allegro/src
 */
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule, ADAPTER_FACTORY_RESOLVER_TOKEN, AdapterFactoryResolverService } from '@openlinker/core/integrations';
import { AllegroAdapterFactoryWrapper } from './infrastructure/adapters/allegro-adapter-factory-wrapper';
import { AllegroQuantityCommandOrmEntity } from './infrastructure/persistence/entities/allegro-quantity-command.orm-entity';
import { AllegroQuantityCommandRepository } from './infrastructure/persistence/repositories/allegro-quantity-command.repository';
import { ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN } from './allegro.tokens';
import { Logger } from '@openlinker/shared/logging';

@Module({
  imports: [
    IntegrationsModule,
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
  ) {}

  onModuleInit(): void {
    this.logger.log('Registering Allegro adapter factory...');
    const factory = new AllegroAdapterFactoryWrapper();
    this.factoryResolver.registerFactory('allegro.publicapi.v1', factory);
    this.logger.log('Allegro adapter factory registered successfully');
  }
}

