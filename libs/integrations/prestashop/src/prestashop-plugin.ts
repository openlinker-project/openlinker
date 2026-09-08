/**
 * PrestaShop Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` describing the PrestaShop WebService v1
 * integration. Holds the manifest, the side-registrations the host wires
 * into its registries at boot (connection tester, webhook provisioner),
 * and the per-connection `createCapabilityAdapter` factory.
 *
 * Plugin-specific cross-package deps (`PrestashopCustomerProvisioner`,
 * `PrestashopAddressProvisioner`, `CustomerProjectionRepositoryPort`,
 * `IMappingConfigService`, `WebhookSecretProviderPort`,
 * `PrestashopWebhookProvisioningAdapter`) are passed via the factory
 * constructor — they're NOT part of the curated `HostServices` bag, by
 * design (#593 §1 non-goals).
 *
 * Consumed by `PrestashopIntegrationModule.onModuleInit` — the descriptor
 * is built inline at boot from the module's `@Inject`'d fields and then
 * registered against the host registries. See
 * `docs/plans/implementation-plan-adapter-plugin-contract.md` § 3.4 for
 * the canonical recipe.
 *
 * @module libs/integrations/prestashop/src
 */
import type { ConfigService } from '@nestjs/config';
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopAdapterFactory } from './application/prestashop-adapter.factory';
import { PrestashopConnectionTesterAdapter } from './infrastructure/adapters/prestashop-connection-tester.adapter';
import { PrestashopConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/prestashop-connection-config-shape-validator.adapter';
import { PrestashopWebhookEventTranslatorAdapter } from './infrastructure/adapters/prestashop-webhook-event-translator.adapter';
import { PrestashopRetryClassifierAdapter } from './infrastructure/adapters/prestashop-retry-classifier.adapter';
import { PrestashopConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter';
import { buildPrestashopSchedulerTasks } from './infrastructure/scheduler/prestashop-scheduler-tasks';
import type { PrestashopCustomerProvisioner } from './infrastructure/provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from './infrastructure/provisioners/prestashop-address-provisioner';
import type { PrestashopWebhookProvisioningAdapter } from './infrastructure/adapters/prestashop-webhook-provisioning.adapter';

export interface CreatePrestashopPluginDeps {
  readonly customerProvisioner: PrestashopCustomerProvisioner;
  readonly addressProvisioner: PrestashopAddressProvisioner;
  readonly customerProjectionRepository: CustomerProjectionRepositoryPort;
  readonly mappingConfigService: IMappingConfigService;
  readonly webhookSecretProvider: WebhookSecretProviderPort;
  readonly webhookProvisioningAdapter: PrestashopWebhookProvisioningAdapter;
  /**
   * NestJS ConfigService — used to build scheduler tasks
   * (`buildPrestashopSchedulerTasks`, #834). When absent (unit-test
   * bootstraps), the plugin skips scheduler-task registration.
   */
  readonly configService?: ConfigService;
}

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so consumers can read manifest fields
 * without instantiating the full plugin. The runtime path
 * (`createPrestashopPlugin(deps).manifest`) returns this same reference, so
 * there's no drift between static and runtime views.
 */
export const prestashopAdapterManifest: AdapterMetadata = {
  adapterKey: 'prestashop.webservice.v1',
  platformType: 'prestashop',
  supportedCapabilities: [
    'ProductMaster',
    'InventoryMaster',
    'OrderSource',
    'OrderProcessorManager',
    'ProductPublisher',
    'CategoryProvisioner',
  ],
  displayName: 'PrestaShop WebService v1',
  version: '1.0.0',
  isDefault: true,
  // Resolution-time fallback for a connection with no explicit
  // config.rateLimit (#1810/#1772); never written into stored config. A
  // self-hosted PrestaShop is the operator's OWN webserver - simultaneously
  // the throughput bottleneck and busy serving customers - which is why a
  // default belongs here at all (#1815).
  //
  // 300/min is one request every 200 ms. `requestsPerMinute` is strict
  // minimum-interval spacing with NO burst, CAS'd in Redis across every
  // replica (#2015), so the shop sees an evenly spaced 5 req/s and never a
  // spike. Peak concurrency stays at ~1, which is why `maxConcurrent: 4` is
  // not binding at this rate and is left alone.
  //
  // MEASURED, not inherited (#2840,
  // perf/openlinker-throughput/results-weak-shop-2026-09-07.md). PrestaShop
  // 9.0.2 with a 50 000-product catalogue, driven at 1-10 req/s of
  // create-path reads across six CPU profiles, with the database squeezed
  // alongside the shop on the small ones. Every constraint was read back from
  // both the daemon and the container's own cgroup:
  //
  //   5 req/s (this default) is FREE down to 0.5 cpu (p99 78 ms), and
  //   DEGRADES but never fails at 0.25 cpu (p99 143 ms; 3000/3000 ok over a
  //   sustained 10 min with the tail flat). NOTHING refused at any profile or
  //   rate - a constrained shop QUEUES, it does not shed.
  //
  // THE BOUND: this is not support for 600. 10 req/s is free at 1.0 cpu
  // (p99 20 ms) and collapses below it - p99 617 ms at 0.5 cpu, 2126 ms at
  // 0.25 cpu. The knee for THIS value sits between 0.5 and 0.25 cpu.
  //
  // AND DO NOT RAISE `maxConcurrent` ON THE STRENGTH OF THIS. The limiter is
  // WEIGHT-BLIND: it admits five requests per second whether each costs 11 ms
  // (a create-path read) or 1021 ms (a `display=full` catalogue page on a
  // quarter-core shop - both measured). Pacing bounds ARRIVAL; `maxConcurrent`
  // bounds SIMULTANEOUS WORK, and it is the latter that stops a sweep's heavy
  // pages from swamping a small shop. It is deliberately left at 4.
  //
  // WHAT IT DOES NOT COVER: synthetic cgroup limits on one host are not a
  // hosting provider's abuse policy. #1810's report was an abuse NOTICE, and
  // a rule counting requests per hour is not reproducible this way - a busy
  // install really can send ~5x more per hour at this ceiling. If that
  // notice's text ever surfaces a request quota, re-derive from the quota
  // rather than from this measurement.
  //
  // Deliberately NOT copied to any other manifest: WooCommerce and Subiekt
  // carry their own, still unmeasured, 60/4, and moving them on the strength
  // of a PrestaShop measurement is the mistake docs/lessons.md exists to
  // prevent ("Never copy another platform's `defaultRateLimit` figure").
  defaultRateLimit: { requestsPerMinute: 300, maxConcurrent: 4 },
};

/**
 * Short brand label used as the `pluginName` argument when this plugin's
 * adapters raise domain exceptions (`InvalidConnectionConfigException`,
 * `InvalidCredentialsShapeException`). `manifest.displayName` reads as
 * "PrestaShop WebService v1" which is too long for an error prefix; this
 * constant keeps the user-facing label co-located with the manifest so a
 * rebrand touches one line, not every adapter.
 */
const PRESTASHOP_BRAND = 'PrestaShop';

export function createPrestashopPlugin(deps: CreatePrestashopPluginDeps): AdapterPlugin {
  // One factory for the lifetime of the plugin, not one per capability
  // resolution (#2592).
  //
  // The factory's resolver fields (shop currency, features, product tax rate,
  // order currency) each carry a per-connection cache and each says in its own
  // docblock that it is a "process-singleton" so the cache survives the adapter
  // instances the master sweep builds per product. Constructing the factory
  // inside `createCapabilityAdapter` discarded every one of those caches on the
  // next job, so the code described a lifetime it did not have: measured, the
  // shop's default currency was re-read on EVERY child job, two requests each
  // (`GET /api/configurations` + `GET /api/currencies/<id>`), which was 2 of
  // 7.96 requests per SKU on a catalogue sweep and 2 of 3.00 on an inventory
  // sweep.
  //
  // Hoisting is safe because the factory holds no per-connection state: its
  // constructor takes only connection-independent collaborators, and the
  // connection is a parameter of `createAdapters`, not a field.
  //
  // Every one of those caches is now process-lifetime, so each entry has to be
  // safe to serve to a later job, and the TTLs on them are real for the first
  // time. Two things follow, both handled where the caches live rather than
  // here. The factory drops a connection's caches when the shop identity in its
  // config changes, so repointing a connection at another shop does not keep
  // serving the old shop's answers under the same key - see
  // `PrestashopAdapterFactory.dropCachesOnShopIdentityChange`. And the tax-rate
  // cache, the one whose key space grows with SKU count, sweeps expired entries
  // under a cap, because a sweep never reads an entry again and so never evicts
  // one.
  const factory = new PrestashopAdapterFactory(
    deps.customerProvisioner,
    deps.addressProvisioner,
    deps.customerProjectionRepository,
    deps.mappingConfigService,
    deps.webhookSecretProvider,
  );

  return {
    manifest: prestashopAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionTesterAdapter(host.http, prestashopAdapterManifest.defaultRateLimit),
      );
      // Webhook provisioner — replaces direct injection of the PS-specific
      // service in `apps/api`'s ConnectionController (#583). The controller
      // resolves provisioners by adapterKey via the registry.
      host.webhookProvisioningRegistry.register(
        'prestashop.webservice.v1',
        deps.webhookProvisioningAdapter,
      );
      // Inbound webhook-event translator (ADR-015 / #903) — decodes PS
      // order/stock/product events into neutral CanonicalInboundEvents.
      host.webhookEventTranslatorRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopWebhookEventTranslatorAdapter(),
      );
      // Retry classification (#581 / #2052) — the package registered none
      // before, so a PrestaShop tax-configuration error was retried five times
      // with backoff before an operator saw it.
      host.retryClassifierRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopRetryClassifierAdapter(),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionConfigShapeValidatorAdapter(PRESTASHOP_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionCredentialsShapeValidatorAdapter(PRESTASHOP_BRAND),
      );
      if (deps.configService) {
        for (const task of buildPrestashopSchedulerTasks(deps.configService)) {
          host.schedulerTaskRegistry.register(task);
        }
      } else {
        // Unit-test bootstrap (no ConfigService). Production wiring always
        // passes one; if a runtime path ever lands here, the scheduler
        // task simply doesn't fire and the operator sees the gap via
        // missing cursor advancement. This log line makes the gap
        // greppable when triaging "why isn't branch-1 status-sync running?"
        host.logger(`${PRESTASHOP_BRAND}IntegrationModule`).debug(
          'Skipping scheduler-task registration: no ConfigService provided to createPrestashopPlugin (expected in unit-test bootstraps only).',
        );
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
        host.http.forConnection(connection, prestashopAdapterManifest.defaultRateLimit),
        // #2369: backs adjustInventory's idempotency window. `HostServices.cache`
        // is optional, so an unwired host degrades to 'unsupported' rather than
        // claiming a dedupe that did not happen.
        host.cache,
      );

      return dispatchCapability<T>(
        capability,
        {
          ProductMaster: () => adapters.productMaster,
          InventoryMaster: () => adapters.inventoryMaster,
          OrderSource: () => adapters.orderSource,
          // Null guard preserved — OrderProcessorManager is conditionally
          // wired up by the factory (depends on customer provisioner +
          // customer projection repository). A configured-but-missing
          // OPM is a deeper error than "capability not supported" — keep
          // the bespoke message.
          OrderProcessorManager: () => {
            if (!adapters.orderProcessorManager) {
              throw new Error(
                'OrderProcessorManager adapter is not available. ' +
                  'Customer provisioner and customer projection repository are required for order processing.',
              );
            }
            return adapters.orderProcessorManager;
          },
          // ProductPublisher and CategoryProvisioner are both implemented by
          // PrestashopProductPublisherAdapter. CategoryProvisioner needs its
          // own dispatch entry because IntegrationsService.getCapabilityAdapter
          // looks up by capability string — dispatchCapability would throw
          // "adapter does not support capability: CategoryProvisioner" without it.
          ProductPublisher: () => adapters.productPublisher,
          CategoryProvisioner: () => adapters.productPublisher,
        },
        PRESTASHOP_BRAND,
      );
    },
  };
}
