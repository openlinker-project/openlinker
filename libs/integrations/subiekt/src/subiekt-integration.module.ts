/**
 * Subiekt Integration Module (#753)
 *
 * Host wiring for the Subiekt nexo invoicing plugin. Subiekt has no
 * plugin-specific NestJS providers, so it uses the SDK's
 * `createNestAdapterModule` directly — the helper builds the `HostServices`
 * bag, registers the manifest + factory, and calls `plugin.register(host)`.
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as the
 * single edit point that enables the plugin in both hosts.
 *
 * @module libs/integrations/subiekt/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createSubiektPlugin } from './subiekt-plugin';

export const SubiektIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createSubiektPlugin(),
});
