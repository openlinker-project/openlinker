/**
 * Worker Plugins
 *
 * Declares the integration plugins enabled by `apps/worker`. Composed by
 * `PluginRegistryModule.forRoot({ plugins: workerPlugins })` inside
 * `apps/worker/src/app.module.ts`.
 *
 * To enable a third-party plugin in the worker:
 *
 *   1. `pnpm add @third-party/openlinker-plugin-<name>` in `apps/worker`.
 *   2. Import its module here.
 *   3. Add it to the `workerPlugins` array below.
 *
 * The worker does not need `AiIntegrationModule` because the AI suggestion
 * flow is handled synchronously in-process by the API.
 *
 * See `docs/architecture-overview.md` § *Adapter Registry (Code-Level)* for
 * the conceptual model.
 *
 * @module apps/worker/src
 */
import type { PluginEntry } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';

export const workerPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
];
