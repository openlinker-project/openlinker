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
import { SubiektController } from './http/subiekt.controller';
import { ConnectionService } from './application/services/connection.service';
import { CONNECTION_SERVICE_TOKEN } from './application/interfaces/connection.service.interface';
import { OAuthConnectionService } from './application/services/oauth-connection.service';
import { OAUTH_CONNECTION_SERVICE_TOKEN } from './application/interfaces/oauth-connection.service.interface';
import { DemoModeService } from '../auth/demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from '../auth/demo-mode.service.interface';

@Module({
  imports: [
    CoreIntegrationsModule,
    IdentifierMappingModule,
    SyncModule, // Required for cursor repository
    RedisConfigModule, // Required for OAuth state storage
    PluginRegistryModule.forRoot({ plugins: apiPlugins }),
  ],
  controllers: [ConnectionController, AdapterController, AllegroController, SubiektController],
  providers: [
    ConnectionService,
    { provide: CONNECTION_SERVICE_TOKEN, useExisting: ConnectionService },
    // Neutral OAuth orchestration (#859). Allegro's OAuth knowledge (URLs,
    // token exchange, `/me`) now lives in the plugin behind OAuthCompletionPort,
    // resolved at runtime via OAuthCompletionRegistryService — so the host no
    // longer imports AllegroAccountReader or any Allegro OAuth service.
    OAuthConnectionService,
    { provide: OAUTH_CONNECTION_SERVICE_TOKEN, useExisting: OAuthConnectionService },
    // Wired locally (mirrors SystemModule) — DemoModeService depends only on
    // the global ConfigService, so IntegrationsModule doesn't need AuthModule
    // just to gate demo-viewer config visibility (#1616 review fix).
    DemoModeService,
    { provide: DEMO_MODE_SERVICE_TOKEN, useExisting: DemoModeService },
  ],
  // CoreIntegrationsModule is re-exported so downstream modules (e.g. HealthModule,
  // for the infra-connection health rollup, #1619) can inject INTEGRATIONS_SERVICE_TOKEN
  // via this module without re-importing CoreIntegrationsModule directly.
  // (NestJS dedupes the singleton instance, so plugin-registered testers stay intact.)
  exports: [PluginRegistryModule, CoreIntegrationsModule, CONNECTION_SERVICE_TOKEN],
})
export class IntegrationsModule {}
