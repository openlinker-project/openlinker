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
import { RedisConfigModule } from '@openlinker/shared/redis';
import { ConnectionController } from './http/connection.controller';
import { AdapterController } from './http/adapter.controller';
import { AllegroController } from './http/allegro.controller';
import { ConnectionService } from './application/services/connection.service';
import { AllegroOAuthService } from './application/services/allegro-oauth.service';

@Module({
  imports: [
    CoreIntegrationsModule,
    IdentifierMappingModule,
    SyncModule, // Required for cursor repository
    RedisConfigModule, // Required for OAuth state storage
    PrestashopIntegrationModule, // Register PrestaShop adapter factory
    AllegroIntegrationModule, // Register Allegro adapter factory
  ],
  controllers: [ConnectionController, AdapterController, AllegroController],
  providers: [ConnectionService, AllegroOAuthService],
})
export class IntegrationsModule {}

