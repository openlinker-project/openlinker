/**
 * API Plugins
 *
 * Declares the integration plugins enabled by `apps/api`. Composed by
 * `PluginRegistryModule.forRoot({ plugins: apiPlugins })` inside
 * `apps/api/src/integrations/integrations.module.ts`.
 *
 * Adding a new integration? See `docs/plugin-author-guide.md` for the
 * full walkthrough (package layout, capability ports, factory wiring,
 * credentials/OAuth, tests). This file is the host-side enablement
 * step.
 *
 * To enable a third-party plugin:
 *
 *   1. `pnpm add @third-party/openlinker-plugin-<name>` in `apps/api`.
 *   2. Import its module here.
 *   3. Add it to the `apiPlugins` array below.
 *
 * Each plugin module remains responsible for self-registering its adapter
 * metadata + factories via `onModuleInit` against the `AdapterRegistryService`
 * / `AdapterFactoryResolverService`. See `docs/architecture-overview.md`
 * § *Adapter Registry (Code-Level)* for the conceptual model.
 *
 * `AiIntegrationModule.register()` is dynamic — it reads `OL_AI_PROVIDER` at
 * construction time. The other modules are static.
 *
 * @module apps/api/src
 */
import type { PluginEntry } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { AiIntegrationModule } from '@openlinker/integrations-ai';
import { InpostIntegrationModule } from '@openlinker/integrations-inpost';
import { DpdIntegrationModule } from '@openlinker/integrations-dpd-polska';
import { WooCommerceIntegrationModule } from '@openlinker/integrations-woocommerce';

export const apiPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
  AiIntegrationModule.register(),
  InpostIntegrationModule,
  DpdIntegrationModule,
  WooCommerceIntegrationModule,
];
