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
// #2084 — ConnectionService bootstraps a connection's category tree on
// create/enable, which needs DESTINATION_TAXONOMY_SERVICE_TOKEN. No cycle: the
// core ListingsModule imports the CORE IntegrationsModule, a different class
// from this host module, and libs/core cannot import apps/api at all.
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
// #2407 — provides LOCATION_SERVICE_TOKEN for the routing enablement guard.
// Safe for the same reason CoreListingsModule is: the core InventoryModule
// imports the CORE IntegrationsModule, a different class from this one.
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { WebhooksCoreModule } from '@openlinker/core/webhooks';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { RateLimitModule } from '@openlinker/plugin-sdk';
import { WebhookDeliveryQueryService } from '../webhooks/application/services/webhook-delivery-query.service';
import { WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN } from '../webhooks/application/interfaces/webhook-delivery-query.service.interface';
import { apiPlugins } from '../plugins';
import { ConnectionController } from './http/connection.controller';
import { AdapterController } from './http/adapter.controller';
import { AllegroController } from './http/allegro.controller';
import { SubiektController } from './http/subiekt.controller';
import { ConnectionService } from './application/services/connection.service';
import { CONNECTION_SERVICE_TOKEN } from './application/interfaces/connection.service.interface';
import { OAuthConnectionService } from './application/services/oauth-connection.service';
import { OAUTH_CONNECTION_SERVICE_TOKEN } from './application/interfaces/oauth-connection.service.interface';
import { WebhookStatusService } from './application/services/webhook-status.service';
import { WEBHOOK_STATUS_SERVICE_TOKEN } from './application/interfaces/webhook-status.service.interface';
import { RateLimitStatusService } from './application/services/rate-limit-status.service';
import { RATE_LIMIT_STATUS_SERVICE_TOKEN } from './application/interfaces/rate-limit-status.service.interface';
import { DemoModeService } from '../auth/demo-mode.service';
import { DEMO_MODE_SERVICE_TOKEN } from '../auth/demo-mode.service.interface';

@Module({
  imports: [
    CoreIntegrationsModule,
    CoreListingsModule, // #2084 taxonomy bootstrap on connection create/enable
    CoreInventoryModule, // #2407 routing enablement guard reads the location count
    IdentifierMappingModule,
    SyncModule, // Required for cursor repository
    WebhooksCoreModule, // Webhook-delivery repository for the webhook-status projection (#1770)
    RedisConfigModule, // Required for OAuth state storage
    // ConnectionService depends on HTTP_TRANSPORT_FACTORY_TOKEN directly
    // (#1810) — imported explicitly here rather than relying on it leaking
    // in as a side effect of apiPlugins happening to include a plugin that
    // imports this @Global() module (tech-review finding on #1957: a fork
    // that trims apiPlugins to zero entries would otherwise fail to boot
    // with an opaque "no provider for HTTP_TRANSPORT_FACTORY_TOKEN" error).
    RateLimitModule,
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
    // Local binding of the webhook-delivery query service (backed by
    // WebhooksCoreModule's repository) so the status projection can read
    // deliveries without importing the heavy WebhooksModule (Redis loop +
    // controllers) into this widely-imported module (#1770).
    WebhookDeliveryQueryService,
    { provide: WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN, useExisting: WebhookDeliveryQueryService },
    WebhookStatusService,
    { provide: WEBHOOK_STATUS_SERVICE_TOKEN, useExisting: WebhookStatusService },
    // Platform-neutral (#1810 Phase 4 rebase of the PrestaShop-only #1815
    // prerequisite). Depends on RATE_LIMITER_REGISTRY_TOKEN, exported
    // process-wide by the @Global() RateLimitModule (bootstrapped via
    // PluginRegistryModule.forRoot({ plugins: apiPlugins }) above) — no
    // explicit import needed here.
    RateLimitStatusService,
    { provide: RATE_LIMIT_STATUS_SERVICE_TOKEN, useExisting: RateLimitStatusService },
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
