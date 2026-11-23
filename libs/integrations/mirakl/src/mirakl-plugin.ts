/**
 * Mirakl Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for one Mirakl operator. The Mirakl
 * Seller API is the same on every Mirakl marketplace, so the plugin is built
 * from an operator profile (`createMiraklPlugin(empikOperatorProfile)`), and
 * each profile becomes its own adapter key, platform type and connection type
 * (ADR-086).
 *
 * It registers what every capability depends on (config and credentials
 * validators, the connection tester, the retry and auth-failure classifiers)
 * and advertises `OrderSource` (#4275): the orders poll, which also accepts
 * new orders, and `OfferManager` (#4277): stock and price for offers listed
 * on the operator, offer linking and offer status. Each capability is added to
 * `supportedCapabilities` together with the adapter that delivers it, in
 * lockstep with the dispatch table below.
 *
 * Mirakl offers sellers no webhooks (they are operator-only), so the plugin
 * registers no webhook decoder or provisioner; capabilities poll.
 *
 * @module libs/integrations/mirakl/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  MiraklAdapterFactory,
  type MiraklAdapterFactoryDeps,
} from './application/mirakl-adapter.factory';
import type { MiraklOperatorProfile } from './domain/types/mirakl-operator-profile.types';
import { MiraklAuthFailureClassifierAdapter } from './infrastructure/adapters/mirakl-auth-failure-classifier.adapter';
import { MiraklConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/mirakl-connection-config-shape-validator.adapter';
import { MiraklConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/mirakl-connection-credentials-shape-validator.adapter';
import { MiraklConnectionTesterAdapter } from './infrastructure/adapters/mirakl-connection-tester.adapter';
import { MiraklEmailNormalizerAdapter } from './infrastructure/adapters/mirakl-email-normalizer.adapter';
import { MiraklRetryClassifierAdapter } from './infrastructure/adapters/mirakl-retry-classifier.adapter';
import { buildMiraklSchedulerTasks } from './infrastructure/scheduler/mirakl-scheduler-tasks';

/**
 * Manifest for an operator. No `defaultRateLimit` (#1810): a manifest default
 * is for merchant-hosted platforms, and Mirakl publishes no ceiling, so any
 * number here would be invented. 429s are handled with `Retry-After` in the
 * client; an operator can still set `connection.config.rateLimit`.
 */
export function buildMiraklAdapterManifest(profile: MiraklOperatorProfile): AdapterMetadata {
  return {
    adapterKey: profile.adapterKey,
    platformType: profile.platformType,
    // Sub-capabilities are listed for host-side discovery only; they are
    // resolved by narrowing the dispatched adapter with core's guards.
    supportedCapabilities: [
      'OrderSource',
      'OfferManager',
      'OfferLister',
      'OfferStatusReader',
      'OfferQuantityBatchUpdater',
      'PendingQuantityAckReconciler',
      'OfferFieldUpdater',
    ],
    displayName: profile.displayName,
    version: profile.version,
    isDefault: true,
  };
}

export function createMiraklPlugin(
  profile: MiraklOperatorProfile,
  deps: MiraklAdapterFactoryDeps = {},
): AdapterPlugin {
  const manifest = buildMiraklAdapterManifest(profile);
  const factory = new MiraklAdapterFactory(profile, deps);

  return {
    manifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        profile.adapterKey,
        new MiraklConnectionConfigShapeValidatorAdapter(profile.brand),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        profile.adapterKey,
        new MiraklConnectionCredentialsShapeValidatorAdapter(profile.brand),
      );
      host.connectionTesterRegistry.register(
        profile.adapterKey,
        new MiraklConnectionTesterAdapter(host.http, factory, profile.brand),
      );
      // The runner asks every registered classifier (it holds the raw error, not
      // an adapter key), so the key is a label; each classifier only recognises
      // Mirakl's own exceptions, so registering one per operator is harmless.
      host.retryClassifierRegistry.register(profile.adapterKey, new MiraklRetryClassifierAdapter());
      host.authFailureClassifierRegistry.register(
        profile.adapterKey,
        new MiraklAuthFailureClassifierAdapter(),
      );
      host.emailNormalizerRegistry.register(profile.adapterKey, new MiraklEmailNormalizerAdapter());
      // Registered unconditionally; the env gate is re-read at every tick.
      for (const task of buildMiraklSchedulerTasks(profile)) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapters = await factory.createAdapters(
        connection,
        host.credentialsResolver,
        // Connection-bound outbound transport (#1810): the operator's own rate
        // limit, if any; the manifest declares no default.
        host.http.forConnection(connection),
      );
      return dispatchCapability<T>(
        capability,
        { OrderSource: () => adapters.orderSource, OfferManager: () => adapters.offerManager },
        profile.brand,
      );
    },
  };
}
