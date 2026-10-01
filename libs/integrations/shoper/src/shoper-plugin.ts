/**
 * Shoper Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shoper REST API integration.
 * Registers the adapter, a connection tester, the config + credentials shape
 * validators and the auth-failure classifier (#3639), plus the read side of
 * `ProductMaster` (#3675). Each further capability enters
 * `supportedCapabilities` together with the adapter that delivers it (the Erli
 * #980 rule), in its own task of the Shoper milestone (#3640-#3644); until
 * then asking for one fails with the SDK's uniform "does not support" error.
 *
 * Not declared, and each for a stated reason:
 *   - `defaultRateLimit` - Shoper's real request ceiling is unconfirmed
 *     (SPIKE-3638 C6: a 25-request burst was never throttled; the shop only
 *     reports `x-shop-api-limit: 10`, unit unknown). Inventing a number is
 *     worse than none; absent means unlimited until the operator sets
 *     `config.rateLimit`.
 *   - a retry classifier - the default (retryable) treatment fits the read
 *     failures this adapter raises today; a permanent-failure classification
 *     arrives with the first capability that writes.
 *   - Sales documents (invoice / receipt) - confirmed absent from Shoper's API
 *     (SPIKE-3638), a deliberate scope boundary, not a gap.
 *
 * @module libs/integrations/shoper/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { SHOPER_ADAPTER_KEY, SHOPER_BRAND, SHOPER_PLATFORM_TYPE } from './shoper.constants';
import { ShoperAdapterFactory } from './application/shoper-adapter.factory';
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
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: ['ProductMaster'],
  displayName: 'Shoper REST API',
  version: '1.0.0',
  isDefault: true,
};

export function createShoperPlugin(): AdapterPlugin {
  // One factory for the plugin's lifetime. It holds no state: the connection,
  // its credentials and the HTTP client are all parameters of `createAdapters`.
  const factory = new ShoperAdapterFactory();

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

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
        // Connection-bound outbound transport (#1810). No manifest default rate
        // limit is passed - this plugin declares none (SPIKE-3638 C6).
        host.http.forConnection(connection),
      );
      return dispatchCapability<T>(
        capability,
        { ProductMaster: () => adapters.productMaster },
        SHOPER_BRAND,
      );
    },
  };
}
