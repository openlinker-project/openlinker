/**
 * Empik Integration Module
 *
 * Host wiring for Empik Marketplace: the shared Mirakl plugin built from the
 * Empik operator profile. The plugin needs no providers of its own, so it uses
 * the SDK's `createNestAdapterModule`, which builds `HostServices` from DI and
 * registers the manifest, factory and side-registrations.
 *
 * One module per operator: a second Mirakl marketplace gets a sibling module
 * with its own profile instead of editing this one.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/mirakl/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createMiraklPlugin } from './mirakl-plugin';
import { empikOperatorProfile } from './operators/empik.profile';

export const EmpikIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createMiraklPlugin(empikOperatorProfile),
});
