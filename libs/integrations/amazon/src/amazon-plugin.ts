/**
 * Amazon Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Amazon Selling Partner API
 * (FR / DE / PL first, #3741). This is the plugin foundation: it registers the
 * connection tester, the config + credentials shape validators and the retry
 * and auth-failure classifiers, and resolves a connection into an SP-API
 * client (`AmazonAdapterFactory`).
 *
 * A capability name enters `supportedCapabilities` together with the adapter
 * that delivers it (the Erli #980 rule), because `listCapabilityAdapters`
 * treats a factory that cannot build a declared capability as fatal.
 * `OrderSource` arrived with #4178 (order feed, tracking write-back, mapping
 * options, the `amazon-orders-poll` task and the email normalizer);
 * `OfferManager` with #4180 (listing link by SKU, FBM stock, price, status);
 * `CategoryBrowser`, `EanCategoryMatcher` and `OfferCreator` with #4181, advertised-without-dispatch
 * like Allegro's: resolved by narrowing the `OfferManager` adapter with their
 * guards, never through `getCapabilityAdapter`.
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
import { AmazonEmailNormalizerAdapter } from './infrastructure/adapters/amazon-email-normalizer.adapter';
import { buildAmazonSchedulerTasks } from './infrastructure/scheduler/amazon-scheduler-tasks';
import { AmazonAdapterFactory } from './application/amazon-adapter.factory';
import type { AmazonResolution } from './application/interfaces/amazon-adapter.factory.interface';

/**
 * Static plugin manifest (#575); `createAmazonPlugin().manifest` returns this
 * same reference.
 */
export const amazonAdapterManifest: AdapterMetadata = {
  adapterKey: AMAZON_ADAPTER_KEY,
  platformType: AMAZON_PLATFORM_TYPE,
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: ['OrderSource', 'OfferManager', 'CategoryBrowser', 'EanCategoryMatcher', 'OfferCreator'],
  // Opt-in: ingesting a seller's Amazon orders creates them in every
  // destination.
  defaultEnabledCapabilities: [],
  // Amazon's Data Protection Policy: buyer personal data is deleted no later
  // than 30 days after delivery. Enforced by the order buyer-data retention
  // pass (#4178).
  buyerDataRetentionDays: 30,
  displayName: 'Amazon Selling Partner API',
  version: '0.1.0',
  isDefault: true,
};

export function createAmazonPlugin(): AdapterPlugin {
  const factory = new AmazonAdapterFactory();
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
      host.emailNormalizerRegistry.register(AMAZON_ADAPTER_KEY, new AmazonEmailNormalizerAdapter());
      for (const task of buildAmazonSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    createCapabilityAdapter<T>(connection: Connection, capability: string, host: HostServices): Promise<T> {
      // Dispatch FIRST, build lazily: an unsupported capability fails with the
      // SDK's uniform error before any credential is decrypted.
      const resolve = (): Promise<AmazonResolution> =>
        factory.resolve(connection, host.credentialsResolver, host.http.forConnection(connection), host.cache);
      try {
        return dispatchCapability<Promise<T>>(
          capability,
          {
            OrderSource: async () => factory.createOrderSource(await resolve()) as T,
            OfferManager: async () => factory.createOfferManager(await resolve()) as T,
          },
          AMAZON_BRAND,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
