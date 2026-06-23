/**
 * KSeF Integration Module
 *
 * Host wiring for the KSeF Public API v2 plugin. KSeF has no plugin-specific
 * NestJS providers in C2, so it uses the SDK's `createNestAdapterModule`
 * directly: the helper imports the integrations/sync/identifier-mapping modules,
 * builds the `HostServices` bag from DI, and registers the manifest + factory +
 * the descriptor's side-registrations (the config/credentials validators).
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as the
 * single edit point that enables the plugin in both hosts.
 *
 * If a later phase needs plugin-scoped NestJS providers (cert store, scheduler,
 * TypeORM entities), this flips to a custom `@Module` that builds the descriptor
 * in `onModuleInit` — the validator registration path is unchanged either way.
 *
 * @module libs/integrations/ksef/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createKsefPlugin } from './ksef-plugin';

export const KsefIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createKsefPlugin(),
});
