/**
 * Integrations API Module
 *
 * NestJS module for integrations API endpoints. Imports core integrations
 * module and identifier mapping module, registers controllers and services
 * for connection management and adapter discovery.
 *
 * @module apps/api/src/integrations
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { AiIntegrationModule } from '@openlinker/integrations-ai';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { ConnectionController } from './http/connection.controller';
import { AdapterController } from './http/adapter.controller';
import { AllegroController } from './http/allegro.controller';
import { ConnectionService } from './application/services/connection.service';
import { AllegroOAuthService } from './application/services/allegro-oauth.service';
import { ALLEGRO_OAUTH_SERVICE_TOKEN } from './application/interfaces/allegro-oauth.service.interface';

@Module({
  imports: [
    CoreIntegrationsModule,
    IdentifierMappingModule,
    SyncModule, // Required for cursor repository
    RedisConfigModule, // Required for OAuth state storage
    PrestashopIntegrationModule, // Register PrestaShop adapter factory
    AllegroIntegrationModule, // Register Allegro adapter factory
    AiIntegrationModule.register(), // Register AI completion adapter (Anthropic via Vercel AI SDK; Fake when OL_AI_PROVIDER=fake)
  ],
  controllers: [ConnectionController, AdapterController, AllegroController],
  providers: [
    ConnectionService,
    AllegroOAuthService,
    { provide: ALLEGRO_OAUTH_SERVICE_TOKEN, useExisting: AllegroOAuthService },
  ],
  // Re-export `AiIntegrationModule` so downstream modules (e.g. `ContentApiModule`)
  // can resolve `AI_COMPLETION_PORT_TOKEN` through a single import of the API
  // IntegrationsModule, without each consumer having to call `.register()`
  // again (which would duplicate the adapter instance).
  exports: [AiIntegrationModule],
})
export class IntegrationsModule {}

