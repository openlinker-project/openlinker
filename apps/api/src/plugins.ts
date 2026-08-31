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
import { ErliIntegrationModule } from '@openlinker/integrations-erli';
import { KsefIntegrationModule } from '@openlinker/integrations-ksef';
import { SubiektIntegrationModule } from '@openlinker/integrations-subiekt';
import { InfaktIntegrationModule } from '@openlinker/integrations-infakt';
import { EparagonyIntegrationModule } from '@openlinker/integrations-eparagony';
import { FxIntegrationModule } from '@openlinker/integrations-fx';
import { OmsModule } from '@openlinker/oms';

export const apiPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
  AiIntegrationModule.register(),
  InpostIntegrationModule,
  DpdIntegrationModule,
  WooCommerceIntegrationModule,
  ErliIntegrationModule,
  KsefIntegrationModule,
  // #753: Subiekt nexo invoicing adapter — registered so the host can resolve
  // the 'Invoicing' capability for subiekt connections.
  SubiektIntegrationModule,
  // #1281: Infakt accounting invoicing adapter (KSeF submitted via Infakt).
  InfaktIntegrationModule,
  // #1908 / ADR-042: eparagony.pl fiscalization adapter - resolves the
  // 'Fiscalization' capability so an operator can register a completed sale
  // as a Polish fiscal e-receipt.
  EparagonyIntegrationModule,
  // #2123: reference exchange-rate providers (NBP, ECB). NOT a plugin - it
  // registers no adapter manifest and exposes no capability; it appears here
  // purely as a module-composition seam, exactly as AiIntegrationModule does.
  // Registered API-side as well as worker-side so a future API restamp
  // endpoint fails at boot rather than at runtime against an empty registry.
  FxIntegrationModule,
  // #2405 / ADR-055: OpenLinker's own OMS, registered through the same seam as
  // any third-party plugin — no privileged path in core. Its manifest declares
  // `requiresCredentials: false`, which is what lets an operator create the
  // credential-less connection ADR-055 specifies; the row is created on enable
  // and is NEVER seeded by a migration, because a seeded row would enter every
  // existing install's authority candidate sets and flip previously-single
  // candidate selections to `ambiguous`. `.register()` (the shipped
  // `AiIntegrationModule` shape) keeps `OmsModule` a named class while handing
  // back the descriptor-backed DynamicModule.
  OmsModule.register(),
];
