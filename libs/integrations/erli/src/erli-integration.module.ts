/**
 * Erli Integration Module
 *
 * Host wiring for the Erli Shop API v1 plugin. Erli has no plugin-specific
 * NestJS providers, so it uses the SDK's `createNestAdapterModule` directly:
 * the helper imports the integrations/sync/identifier-mapping modules, builds
 * the `HostServices` bag from DI, and registers the manifest + factory.
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as
 * the single edit point that enables the plugin in both hosts.
 *
 * This stays on `createNestAdapterModule` unless Erli later needs
 * plugin-scoped NestJS providers (TypeORM entities, NestJS-managed
 * services). ADR-025's auth model — static API key, no OAuth, no
 * token-refresh — makes that unlikely, so the follow-up issues (#981 HTTP
 * client, #982 validators, #984/#993 adapters) should not reflexively flip
 * this to a custom `@Module` the way Allegro/PrestaShop do: HTTP clients
 * and shape validators are plain classes, and validators register via
 * `plugin.register(host)`, which this helper already invokes.
 *
 * @module libs/integrations/erli/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createErliPlugin } from './erli-plugin';

export const ErliIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createErliPlugin(),
});
