/**
 * Integrations API Module
 *
 * NestJS module for integrations API endpoints. Composes the per-app plugin
 * list (`apiPlugins`) via `PluginRegistryModule.forRoot({ plugins })`, then
 * registers controllers and services for connection management and adapter
 * discovery. Re-exports `PluginRegistryModule` so downstream modules (e.g.
 * `ContentApiModule`) keep resolving per-plugin tokens (`AI_COMPLETION_PORT_TOKEN`,
 * etc.) through a single import of this module.
 *
 * @module apps/api/src/integrations
 */
import { Module } from '@nestjs/common';
import {
  IntegrationsModule as CoreIntegrationsModule,
  PluginRegistryModule,
} from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { apiPlugins } from '../plugins';
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
    PluginRegistryModule.forRoot({ plugins: apiPlugins }),
  ],
  controllers: [ConnectionController, AdapterController, AllegroController],
  providers: [
    ConnectionService,
    AllegroOAuthService,
    { provide: ALLEGRO_OAUTH_SERVICE_TOKEN, useExisting: AllegroOAuthService },
  ],
  exports: [PluginRegistryModule],
})
export class IntegrationsModule {}
