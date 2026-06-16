/**
 * Erli Plugin Descriptor (#980)
 *
 * Framework-neutral `AdapterPlugin` describing the Erli Shop API v1
 * integration. `supportedCapabilities` lists each capability in lockstep with
 * the adapter that delivers it — a registered manifest must declare only
 * capabilities its factory can construct (`IntegrationsService
 * .listCapabilityAdapters` treats any non-`AdapterNotFoundException` factory
 * error as fatal). #984 adds `'OfferManager'` (offers) with
 * `ErliOfferManagerAdapter`; #993 adds `'OrderSource'`.
 *
 * Side-registrations land in `register(host)` (`createNestAdapterModule`
 * invokes it): connection tester + config/credentials shape validators (#982),
 * retry + auth-failure classifiers over the Erli exception hierarchy (#984,
 * ADR-008 — without these a revoked static key would retry-storm instead of
 * flipping the connection to `needs_reauth`).
 *
 * Erli needs no plugin-specific NestJS providers, so the host wires it via
 * `createNestAdapterModule` — see `erli-integration.module.ts`.
 *
 * @module libs/integrations/erli/src
 * @see {@link erliAdapterManifest} for the static manifest (#575 pattern)
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliAdapterFactory } from './application/erli-adapter.factory';
import { ERLI_ADAPTER_KEY } from './erli.constants';
import { ErliAuthFailureClassifierAdapter } from './infrastructure/adapters/erli-auth-failure-classifier.adapter';
import { ErliConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/erli-connection-config-shape-validator.adapter';
import { ErliConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/erli-connection-credentials-shape-validator.adapter';
import { ErliConnectionTesterAdapter } from './infrastructure/adapters/erli-connection-tester.adapter';
import { ErliRetryClassifierAdapter } from './infrastructure/adapters/erli-retry-classifier.adapter';
import { buildErliSchedulerTasks } from './infrastructure/scheduler/erli-scheduler-tasks';

/** Human-readable plugin identifier surfaced in dispatch errors (#573). */
const ERLI_BRAND = 'Erli';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating
 * the plugin. `createErliPlugin().manifest` returns this same reference, so
 * static and runtime views can't drift.
 */
export const erliAdapterManifest: AdapterMetadata = {
  adapterKey: ERLI_ADAPTER_KEY,
  platformType: 'erli',
  // Each capability is added by the PR that ships its adapter, in lockstep with
  // a dispatch-table entry below: #984 → 'OfferManager', #993 → 'OrderSource'.
  supportedCapabilities: ['OfferManager', 'OrderSource'],
  displayName: 'Erli Shop API v1',
  version: '1.0.0',
  isDefault: true,
};

export function createErliPlugin(): AdapterPlugin {
  return {
    manifest: erliAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliConnectionConfigShapeValidatorAdapter(ERLI_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliConnectionCredentialsShapeValidatorAdapter(ERLI_BRAND),
      );
      host.connectionTesterRegistry.register(ERLI_ADAPTER_KEY, new ErliConnectionTesterAdapter());
      // Classifiers (#984). The runner dispatches these OR-across-all (it holds
      // the raw error, not an adapterKey), so the key is a bookkeeping label;
      // safe because each classifier only recognises Erli's own exceptions.
      host.retryClassifierRegistry.register(ERLI_ADAPTER_KEY, new ErliRetryClassifierAdapter());
      host.authFailureClassifierRegistry.register(
        ERLI_ADAPTER_KEY,
        new ErliAuthFailureClassifierAdapter(),
      );
      // Scheduler tasks: offer-status reconciliation (#989) and the
      // `erli-orders-poll` order-source poll (#993) — `buildErliSchedulerTasks`
      // now returns both. Registered unconditionally; each task's env gate
      // (OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED / OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED)
      // is re-checked by the scheduler at each tick (no ConfigService dependency —
      // Erli is wired via createNestAdapterModule).
      for (const task of buildErliSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const factory = new ErliAdapterFactory();
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
        // #1066: distributed frozen-stock flag. Optional on HostServices — when
        // absent the offer adapter fails open (pushes stock = pre-#1066 behaviour).
        host.cache,
      );
      return dispatchCapability<T>(
        capability,
        {
          OfferManager: () => adapters.offerManager,
          OrderSource: () => adapters.orderSource,
        },
        ERLI_BRAND,
      );
    },
  };
}
