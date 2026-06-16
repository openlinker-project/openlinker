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
 * `AiIntegrationModule` is registered here (#737) because the bulk-flow
 * `marketplace.offer.create` handler calls `ContentSuggestionService` for
 * per-job AI description generation. Without this, `AI_COMPLETION_PORT_TOKEN`
 * is unresolved in the worker's DI scope.
 *
 * `InpostIntegrationModule` is registered here (#772) so the worker can resolve
 * the InPost `ShippingProviderManager` adapter when executing the
 * `marketplace.shipment.statusSync` job for InPost connections. (The worker runs
 * no SchedulerService, so InPost's scheduler task registers but never fires
 * here — it is drained only by the api.)
 *
 * See `docs/architecture-overview.md` § *Adapter Registry (Code-Level)* for
 * the conceptual model.
 *
 * @module apps/worker/src
 */
import type { PluginEntry } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { AiIntegrationModule } from '@openlinker/integrations-ai';
import { InpostIntegrationModule } from '@openlinker/integrations-inpost';
import { WooCommerceIntegrationModule } from '@openlinker/integrations-woocommerce';
import { DpdIntegrationModule } from '@openlinker/integrations-dpd-polska';
import { ErliIntegrationModule } from '@openlinker/integrations-erli';

export const workerPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
  AiIntegrationModule.register(),
  InpostIntegrationModule,
  WooCommerceIntegrationModule,
  // #965: resolve the DPD `ShippingProviderManager` adapter when the worker
  // runs `marketplace.shipment.statusSync` for DPD connections (tracking via
  // SOAP DPDInfoServices, ADR-022). Scheduler runs api-side; worker only drains.
  DpdIntegrationModule,
  ErliIntegrationModule,
];
