/**
 * eparagony.pl Integration Module
 *
 * Host wiring for the eparagony.pl Documents API v3 plugin. The plugin has no
 * NestJS providers of its own, so it uses the SDK's `createNestAdapterModule`
 * directly: the helper imports the integrations/sync/identifier-mapping modules,
 * builds the `HostServices` bag from DI, and registers the manifest + factory +
 * the descriptor's side-registrations.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/eparagony/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createEparagonyPlugin } from './eparagony-plugin';

export const EparagonyIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createEparagonyPlugin(),
});
