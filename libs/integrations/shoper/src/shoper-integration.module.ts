/**
 * Shoper Integration Module
 *
 * Host wiring for the Shoper plugin. The plugin has no NestJS providers of its
 * own, so it uses the SDK's `createNestAdapterModule` directly: the helper
 * imports the integrations/sync/identifier-mapping modules, builds the
 * `HostServices` bag from DI, and registers the manifest + factory + the
 * descriptor's side-registrations.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/shoper/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createShoperPlugin } from './shoper-plugin';

export const ShoperIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createShoperPlugin(),
});
