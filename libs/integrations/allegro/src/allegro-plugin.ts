/**
 * Allegro Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` describing the Allegro Public API v1
 * integration. Holds the manifest, the side-registrations the host wires
 * into its registries at boot (connection tester, email normalizer, retry
 * classifier, scheduler tasks), and the per-connection `createCapabilityAdapter`
 * factory.
 *
 * Plugin-specific cross-package deps (`CustomerIdentityResolverPort`,
 * `AllegroTokenRefreshService`, `AllegroQuantityCommandRepositoryPort`,
 * `ConfigService`) are passed via the factory constructor — they're NOT
 * part of the curated `HostServices` bag, by design (#593 §1 non-goals).
 *
 * Consumed by `AllegroIntegrationModule.onModuleInit` — the descriptor is
 * built inline at boot from the module's `@Inject`'d fields and then
 * registered against the host registries. See
 * `docs/plans/implementation-plan-adapter-plugin-contract.md` § 3.4 for
 * the canonical recipe.
 *
 * @module libs/integrations/allegro/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { ConfigService } from '@nestjs/config';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { join } from 'node:path';
import { AllegroAdapterFactory } from './application/allegro-adapter.factory';
import type { QuantityPollConfig } from './infrastructure/adapters/allegro-offer-manager.adapter';
import { AllegroConnectionTesterAdapter } from './infrastructure/adapters/allegro-connection-tester.adapter';
import { AllegroEmailNormalizerAdapter } from './infrastructure/adapters/allegro-email-normalizer.adapter';
import { AllegroRetryClassifierAdapter } from './infrastructure/adapters/allegro-retry-classifier.adapter';
import { AllegroAuthFailureClassifierAdapter } from './infrastructure/adapters/allegro-auth-failure-classifier.adapter';
import { AllegroConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/allegro-connection-config-shape-validator.adapter';
import { AllegroOAuthCompletionAdapter } from './infrastructure/adapters/allegro-oauth-completion.adapter';
import { buildAllegroSchedulerTasks } from './infrastructure/scheduler/allegro-scheduler-tasks';
import type { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
import type { AllegroQuantityCommandRepositoryPort } from './domain/ports/allegro-quantity-command-repository.port';

export interface CreateAllegroPluginDeps {
  /**
   * Retained for backwards-compat. Adapters today don't consume it directly
   * (identity resolution moved to `OrderIngestionService` post-#328); kept
   * on the factory constructor to avoid a breaking signature change.
   */
  readonly customerIdentityResolver?: CustomerIdentityResolverPort;
  readonly tokenRefreshService?: AllegroTokenRefreshService;
  readonly commandRepository?: AllegroQuantityCommandRepositoryPort;
  /** Config-driven Allegro quantity-poll backoff knobs. Read from `OL_ALLEGRO_QUANTITY_POLL_*`. */
  readonly quantityPollConfig?: Partial<QuantityPollConfig>;
  /** Cache TTL override (seconds) for `/sale/categories/{id}/parameters`. Defaults to 24h. */
  readonly catParamsTtlSec?: number;
  /**
   * NestJS ConfigService — used to build scheduler tasks
   * (`buildAllegroSchedulerTasks`). When absent (unit-test bootstraps), the
   * plugin skips scheduler-task registration.
   */
  readonly configService?: ConfigService;
}

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so consumers — manifest-diff CLIs,
 * capability-matrix dashboards, compatibility checks at boot — can read
 * `adapterKey` / `platformType` / `supportedCapabilities` / `version` /
 * `isDefault` **without** instantiating the full plugin (which requires
 * resolving the cross-package deps in `CreateAllegroPluginDeps`).
 *
 * The runtime path (`createAllegroPlugin(deps).manifest`) returns this same
 * reference, so there's no drift between static and runtime views.
 */
export const allegroAdapterManifest: AdapterMetadata = {
  adapterKey: 'allegro.publicapi.v1',
  platformType: 'allegro',
  // `CategoryBrowser` + `CategoryPathReader` + `EanCategoryMatcher` are
  // `OfferManager` sub-capabilities that `AllegroOfferManagerAdapter`
  // implements. They are advertised here - the
  // same way PrestaShop advertises `ProductPublisher` / `CategoryProvisioner`
  // (#1367) — so host-side discovery (the connection response's
  // `supportedCapabilities`) can tell a browsable-taxonomy destination (Allegro:
  // category tree + per-category parameters) from a borrows-taxonomy one (Erli:
  // manual category id, no parameter step). Runtime dispatch is unaffected:
  // both sub-capabilities are resolved by narrowing the `OfferManager` adapter
  // with `isCategoryBrowser` / `isCategoryPathReader` / `isEanCategoryMatcher`,
  // never via `getCapabilityAdapter('CategoryBrowser')`, so no dispatch-table
  // entry is needed.
  //
  // `OfferCreator` + `OfferEventReader` (#1498) follow the same pattern:
  // `AllegroOfferManagerAdapter` implements both, and the FE gates
  // offer-creation flows on `OfferCreator` and the offer-events sync trigger on
  // `OfferEventReader` — so a quantity-only `OfferManager` (WooCommerce stock
  // write-back) never surfaces in marketplace-only offer flows.
  supportedCapabilities: [
    'OrderSource',
    'OfferManager',
    'ShippingProviderManager',
    'CategoryBrowser',
    'CategoryPathReader',
    'EanCategoryMatcher',
    'OfferCreator',
    'OfferEventReader',
  ],
  displayName: 'Allegro Public API v1',
  version: '1.0.0',
  isDefault: true,
};

/**
 * Short brand label used as the `pluginName` argument when this plugin's
 * adapters raise domain exceptions (`InvalidConnectionConfigException`).
 * `manifest.displayName` reads as "Allegro Public API v1" which is too
 * long for an error prefix; this constant keeps the user-facing label
 * co-located with the manifest so a rebrand touches one line.
 */
const ALLEGRO_BRAND = 'Allegro';

export function createAllegroPlugin(deps: CreateAllegroPluginDeps): AdapterPlugin {
  return {
    manifest: allegroAdapterManifest,

    // Plugin-owned migrations (#599). Resolved relative to this file —
    // points at `src/migrations/` in dev and `dist/migrations/` in built
    // output via the `{.ts,.js}` alternation.
    //
    // **Informational only.** TypeORM CLI does not read this field; the
    // canonical seam it reads is `apps/api/src/plugin-migrations.ts`.
    // This array advertises what the plugin owns; the host list enables
    // it. Both must stay aligned — see `AdapterPlugin.migrations` JSDoc.
    migrations: [join(__dirname, 'migrations', '**', '*{.ts,.js}')],

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        'allegro.publicapi.v1',
        new AllegroConnectionTesterAdapter()
      );
      host.emailNormalizerRegistry.register(
        'allegro.publicapi.v1',
        new AllegroEmailNormalizerAdapter()
      );
      host.retryClassifierRegistry.register(
        'allegro.publicapi.v1',
        new AllegroRetryClassifierAdapter()
      );
      host.authFailureClassifierRegistry.register(
        'allegro.publicapi.v1',
        new AllegroAuthFailureClassifierAdapter()
      );
      host.connectionConfigShapeValidatorRegistry.register(
        'allegro.publicapi.v1',
        new AllegroConnectionConfigShapeValidatorAdapter(ALLEGRO_BRAND)
      );
      // OAuth-completion adapter (#859): authorize-URL / code-exchange / `/me`
      // identity. The host's neutral OAuthConnectionService resolves it by
      // adapterKey, so the host never imports Allegro OAuth knowledge.
      host.oauthCompletionRegistry.register(
        'allegro.publicapi.v1',
        new AllegroOAuthCompletionAdapter()
      );
      // Allegro does NOT register a credentials shape validator — token
      // shape is enforced by `AllegroAdapterFactory.resolveCredentials` at
      // adapter construction time (deeper than this boundary).
      if (deps.configService) {
        for (const task of buildAllegroSchedulerTasks(deps.configService)) {
          host.schedulerTaskRegistry.register(task);
        }
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices
    ): Promise<T> {
      const factory = new AllegroAdapterFactory(
        deps.customerIdentityResolver,
        deps.tokenRefreshService,
        deps.commandRepository,
        deps.quantityPollConfig,
        host.cache,
        deps.catParamsTtlSec
      );
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver
      );
      return dispatchCapability<T>(
        capability,
        {
          OfferManager: () => adapters.offerManager,
          OrderSource: () => adapters.orderSource,
          ShippingProviderManager: () => adapters.shippingManager,
        },
        ALLEGRO_BRAND
      );
    },
  };
}
