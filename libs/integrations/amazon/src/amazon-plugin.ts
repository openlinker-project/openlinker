/**
 * Amazon Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Amazon Selling Partner API
 * (FR / DE / PL first, #3741). This is the plugin foundation: it registers the
 * connection tester, the config + credentials shape validators and the retry
 * and auth-failure classifiers, and resolves a connection into an SP-API
 * client (`AmazonAdapterFactory`).
 *
 * `supportedCapabilities` is EMPTY on purpose: a capability name enters the
 * manifest together with the adapter that delivers it (the Erli #980 rule),
 * because `listCapabilityAdapters` treats a factory that cannot build a
 * declared capability as fatal. `OrderSource` and `OfferManager` arrive with
 * their own children of the epic.
 *
 * Authorization: both a self-authorized private app and a public-app OAuth
 * grant end in the same stored LWA credentials (`AmazonCredentials`), so this
 * descriptor needs nothing per source. The OAuth completion adapter (public
 * app) is a later child; it registers on `host.oauthCompletionRegistry` here.
 *
 * No `defaultRateLimit`: SP-API quotas are per operation, not one request
 * rate, and Amazon is multi-tenant SaaS rather than a merchant-hosted box (the
 * Erli and Allegro reasoning). The capability adapters pace each operation.
 *
 * @module libs/integrations/amazon/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { AMAZON_ADAPTER_KEY, AMAZON_BRAND, AMAZON_PLATFORM_TYPE } from './amazon.constants';
import { AmazonAuthFailureClassifierAdapter } from './infrastructure/adapters/amazon-auth-failure-classifier.adapter';
import { AmazonConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/amazon-connection-config-shape-validator.adapter';
import { AmazonConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/amazon-connection-credentials-shape-validator.adapter';
import { AmazonConnectionTesterAdapter } from './infrastructure/adapters/amazon-connection-tester.adapter';
import { AmazonRetryClassifierAdapter } from './infrastructure/adapters/amazon-retry-classifier.adapter';

/**
 * Static plugin manifest (#575); `createAmazonPlugin().manifest` returns this
 * same reference.
 */
export const amazonAdapterManifest: AdapterMetadata = {
  adapterKey: AMAZON_ADAPTER_KEY,
  platformType: AMAZON_PLATFORM_TYPE,
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: [],
  displayName: 'Amazon Selling Partner API',
  version: '0.1.0',
  isDefault: true,
};

export function createAmazonPlugin(): AdapterPlugin {
  return {
    manifest: amazonAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        AMAZON_ADAPTER_KEY,
        new AmazonConnectionTesterAdapter(host.http, host.cache),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        AMAZON_ADAPTER_KEY,
        new AmazonConnectionConfigShapeValidatorAdapter(AMAZON_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        AMAZON_ADAPTER_KEY,
        new AmazonConnectionCredentialsShapeValidatorAdapter(AMAZON_BRAND),
      );
      // The runner asks every registered classifier (it holds the raw error,
      // not an adapter key); safe because each only recognises Amazon's own errors.
      host.retryClassifierRegistry.register(AMAZON_ADAPTER_KEY, new AmazonRetryClassifierAdapter());
      host.authFailureClassifierRegistry.register(AMAZON_ADAPTER_KEY, new AmazonAuthFailureClassifierAdapter());
    },

    createCapabilityAdapter<T>(_connection: Connection, capability: string, _host: HostServices): Promise<T> {
      // Empty until the first capability lands; the SDK answers with its
      // uniform "does not support" error before any credential is decrypted.
      try {
        return dispatchCapability<Promise<T>>(capability, {}, AMAZON_BRAND);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
