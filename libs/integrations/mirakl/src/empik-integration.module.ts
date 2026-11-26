/**
 * Empik Integration Module
 *
 * Host wiring for Empik Marketplace: the shared Mirakl plugin built from the
 * Empik operator profile, through `createMiraklIntegrationModule`, which adds
 * the plugin's offer write store to the SDK's `createNestAdapterModule`.
 *
 * One module per operator: a second Mirakl marketplace gets a sibling module
 * with its own profile instead of editing this one.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/mirakl/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createMiraklIntegrationModule } from './mirakl-integration.module';
import { empikOperatorProfile } from './operators/empik.profile';

export const EmpikIntegrationModule: DynamicModule =
  createMiraklIntegrationModule(empikOperatorProfile);
