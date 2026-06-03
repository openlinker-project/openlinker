/**
 * DPD Polska Integration Module
 *
 * Host wiring for the DPD Polska DPDServices REST plugin. DPD has no
 * plugin-specific NestJS providers, so it uses the SDK's
 * `createNestAdapterModule` directly: the helper imports the
 * integrations/sync/identifier-mapping modules, builds the `HostServices` bag
 * from DI, registers the manifest + factory, and calls `plugin.register(host)`
 * for the config-shape validator.
 *
 * Added to `apps/api/src/plugins.ts` as the single edit point that enables the
 * plugin in the host. Not registered worker-side in this PR (DPD tracking via
 * DPD InfoServices is #965).
 *
 * @module libs/integrations/dpd-polska/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createDpdPlugin } from './dpd-plugin';

export const DpdIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createDpdPlugin(),
});
