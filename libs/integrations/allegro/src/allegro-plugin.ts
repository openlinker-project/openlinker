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
import type { AdapterPlugin, HostServices } from '@openlinker/plugin-sdk';
import type { ConfigService } from '@nestjs/config';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { join } from 'node:path';
import { AllegroAdapterFactory } from './application/allegro-adapter.factory';
import type { QuantityPollConfig } from './infrastructure/adapters/allegro-offer-manager.adapter';
import { AllegroConnectionTesterAdapter } from './infrastructure/adapters/allegro-connection-tester.adapter';
import { AllegroEmailNormalizerAdapter } from './infrastructure/adapters/allegro-email-normalizer.adapter';
import { AllegroRetryClassifierAdapter } from './infrastructure/adapters/allegro-retry-classifier.adapter';
import { buildAllegroSchedulerTasks } from './infrastructure/scheduler/allegro-scheduler-tasks';
import { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
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

export function createAllegroPlugin(deps: CreateAllegroPluginDeps): AdapterPlugin {
  return {
    manifest: {
      adapterKey: 'allegro.publicapi.v1',
      platformType: 'allegro',
      supportedCapabilities: ['OrderSource', 'OfferManager'],
      displayName: 'Allegro Public API v1',
      version: '1.0.0',
      isDefault: true,
    },

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
        new AllegroConnectionTesterAdapter(),
      );
      host.emailNormalizerRegistry.register(
        'allegro.publicapi.v1',
        new AllegroEmailNormalizerAdapter(),
      );
      host.retryClassifierRegistry.register(
        'allegro.publicapi.v1',
        new AllegroRetryClassifierAdapter(),
      );
      if (deps.configService) {
        for (const task of buildAllegroSchedulerTasks(deps.configService)) {
          host.schedulerTaskRegistry.register(task);
        }
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const factory = new AllegroAdapterFactory(
        deps.customerIdentityResolver,
        deps.tokenRefreshService,
        deps.commandRepository,
        deps.quantityPollConfig,
        host.cache,
        deps.catParamsTtlSec,
      );
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
      );
      switch (capability) {
        case 'OfferManager':
          return adapters.offerManager as unknown as T;
        case 'OrderSource':
          return adapters.orderSource as unknown as T;
        default:
          throw new Error(
            `Allegro adapter does not support capability: ${capability}. ` +
              `Supported capabilities: OfferManager, OrderSource`,
          );
      }
    },
  };
}
