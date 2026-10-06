/**
 * Shoper Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shoper REST API integration.
 * This is the connection skeleton (#3639): it registers the adapter, a
 * connection tester, the config + credentials shape validators and the
 * auth-failure classifier. It declares NO capabilities yet - each one enters
 * `supportedCapabilities` together with the adapter that delivers it (the
 * Erli #980 rule), in its own epic of the Shoper milestone (#3640-#3644).
 * Until then `createCapabilityAdapter` dispatches an empty table, so asking
 * for any capability fails with the SDK's uniform "does not support" error.
 *
 * Not declared, and each for a stated reason:
 *   - `defaultRateLimit` - Shoper's real request ceiling is UNKNOWN, not
 *     "unreached": every response carries `x-shop-api-limit: 10` (SPIKE-3638
 *     C5), unit unstated, and the 25-request burst that was never throttled
 *     (C6) is explicitly not evidence of no limit (open risk 2). Inventing a
 *     number is worse than none, so a connection whose operator never sets
 *     `config.rateLimit` is paced by nothing on OpenLinker's side. Revisit once
 *     the longer sustained-rate test risk 2 asks for has run.
 *   - a retry classifier - nothing here enqueues work yet.
 *   - Sales documents (invoice / receipt) - confirmed absent from Shoper's API
 *     (SPIKE-3638), a deliberate scope boundary, not a gap.
 *
 * @module libs/integrations/shoper/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { SHOPER_ADAPTER_KEY, SHOPER_BRAND, SHOPER_PLATFORM_TYPE } from './shoper.constants';
import { ShoperAuthFailureClassifierAdapter } from './infrastructure/adapters/shoper-auth-failure-classifier.adapter';
import { ShoperConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/shoper-connection-config-shape-validator.adapter';
import { ShoperConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/shoper-connection-credentials-shape-validator.adapter';
import { ShoperConnectionTesterAdapter } from './infrastructure/adapters/shoper-connection-tester.adapter';

/**
 * Static plugin manifest (#575). Exported as a top-level `const` so host
 * tooling can read it without instantiating the plugin;
 * `createShoperPlugin().manifest` returns this same reference.
 */
export const shoperAdapterManifest: AdapterMetadata = {
  adapterKey: SHOPER_ADAPTER_KEY,
  platformType: SHOPER_PLATFORM_TYPE,
  supportedCapabilities: [],
  displayName: 'Shoper REST API',
  version: '1.0.0',
  isDefault: true,
};

export function createShoperPlugin(): AdapterPlugin {
  return {
    manifest: shoperAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionTesterAdapter(host.http),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionConfigShapeValidatorAdapter(SHOPER_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperConnectionCredentialsShapeValidatorAdapter(SHOPER_BRAND),
      );
      host.authFailureClassifierRegistry.register(
        SHOPER_ADAPTER_KEY,
        new ShoperAuthFailureClassifierAdapter(),
      );
    },

    createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices,
    ): Promise<T> {
      return Promise.resolve().then(() => dispatchCapability<T>(capability, {}, SHOPER_BRAND));
    },
  };
}
