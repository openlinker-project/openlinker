/**
 * Infakt Integration Module
 *
 * Host wiring for the Infakt Accounting API v3 plugin. Infakt has no
 * plugin-specific NestJS providers, so it uses the SDK's
 * `createNestAdapterModule` directly: the helper imports the
 * integrations/sync/identifier-mapping modules, builds the `HostServices`
 * bag from DI, and registers the manifest + factory + the descriptor's
 * side-registrations (config/credentials validators, retry classifier).
 *
 * Not yet wired into `apps/api/src/plugins.ts` / `apps/worker/src/plugins.ts`
 * — that registration + webhook routing is #1281.
 *
 * @module libs/integrations/infakt/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createInfaktPlugin } from './infakt-plugin';

export const InfaktIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createInfaktPlugin(),
});
