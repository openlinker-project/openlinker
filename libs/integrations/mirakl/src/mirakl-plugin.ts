/**
 * Mirakl Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for one Mirakl operator. The Mirakl
 * Seller API is the same on every Mirakl marketplace, so the plugin is built
 * from an operator profile (`createMiraklPlugin(empikOperatorProfile)`), and
 * each profile becomes its own adapter key, platform type and connection type
 * (ADR-086).
 *
 * This foundation (#4274) advertises no capabilities yet. It registers what
 * every later capability depends on: config and credentials validators, the
 * connection tester, and the retry and auth-failure classifiers. Each
 * capability is added to `supportedCapabilities` together with the adapter
 * that delivers it (#4275 orders, #4277 offers), in lockstep with the dispatch
 * table below.
 *
 * Mirakl offers sellers no webhooks (they are operator-only), so the plugin
 * registers no webhook decoder or provisioner; capabilities poll.
 *
 * @module libs/integrations/mirakl/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { MiraklAdapterFactory } from './application/mirakl-adapter.factory';
import type { MiraklOperatorProfile } from './domain/types/mirakl-operator-profile.types';
import { MiraklAuthFailureClassifierAdapter } from './infrastructure/adapters/mirakl-auth-failure-classifier.adapter';
import { MiraklConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/mirakl-connection-config-shape-validator.adapter';
import { MiraklConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/mirakl-connection-credentials-shape-validator.adapter';
import { MiraklConnectionTesterAdapter } from './infrastructure/adapters/mirakl-connection-tester.adapter';
import { MiraklRetryClassifierAdapter } from './infrastructure/adapters/mirakl-retry-classifier.adapter';

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
    supportedCapabilities: [],
    displayName: profile.displayName,
    version: profile.version,
    isDefault: true,
  };
}

export function createMiraklPlugin(profile: MiraklOperatorProfile): AdapterPlugin {
  const manifest = buildMiraklAdapterManifest(profile);
  const factory = new MiraklAdapterFactory(profile);

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
    },

    createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices,
    ): Promise<T> {
      // No capability yet. `dispatchCapability` rejects with the standard
      // "does not support capability" message; the manifest advertises none,
      // so the host's capability gate stops callers before reaching here.
      return Promise.resolve().then(() => dispatchCapability<T>(capability, {}, profile.brand));
    },
  };
}
