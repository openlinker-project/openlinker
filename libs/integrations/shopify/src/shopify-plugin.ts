/**
 * Shopify Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shopify Admin GraphQL API
 * (2026-10). This is the plugin foundation (#3974): it registers the
 * connection tester, the config + credentials shape validators, the retry
 * and auth-failure classifiers, and the OAuth completion adapter (a store in
 * another organization installs the app through the authorization-code
 * grant). Capabilities enter `supportedCapabilities` together with the adapter
 * that delivers them (the #980 rule); ProductMaster arrived with #3975. Its
 * rungs `ModifiedProductLister`, `BulkProductReader` and `ProductTaxRateReader`
 * are guard-only (never in the manifest), narrowed off the dispatched adapter.
 *
 * Outbound pacing: every call goes through `host.http.forConnection` with
 * `SHOPIFY_DEFAULT_RATE_LIMIT` and the STORE's shared bucket (Shopify's
 * budget is per app and store, ADR-038 § Amendment); query cost is paced by
 * the GraphQL client from Shopify's own `throttleStatus`.
 *
 * Two pieces need collaborators `HostServices` does not carry, so
 * `ShopifyIntegrationModule` supplies them: the OAuth token write-back
 * (credentials service + lock, passed in through `CreateShopifyPluginDeps`)
 * and the archive hook (registered on the core registry directly).
 *
 * @module libs/integrations/shopify/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  SHOPIFY_ADAPTER_KEY,
  SHOPIFY_BRAND,
  SHOPIFY_DEFAULT_RATE_LIMIT,
  SHOPIFY_PLATFORM_TYPE,
} from './shopify.constants';
import { ShopifyAdapterFactory, type ShopifyResolution } from './application/shopify-adapter.factory';
import { resolveShopifyRateLimitBucketKey } from './domain/policies/shopify-rate-limit-bucket.policy';
import {
  createShopifyClientRuntime,
  type ShopifyClientRuntime,
} from './infrastructure/http/shopify-client.builder';
import { ShopifyAuthFailureClassifierAdapter } from './infrastructure/adapters/shopify-auth-failure-classifier.adapter';
import { ShopifyConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/shopify-connection-config-shape-validator.adapter';
import { ShopifyConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/shopify-connection-credentials-shape-validator.adapter';
import { ShopifyConnectionTesterAdapter } from './infrastructure/adapters/shopify-connection-tester.adapter';
import { ShopifyOAuthCompletionAdapter } from './infrastructure/adapters/shopify-oauth-completion.adapter';
import { ShopifyRetryClassifierAdapter } from './infrastructure/adapters/shopify-retry-classifier.adapter';

/**
 * Static plugin manifest (#575); `createShopifyPlugin().manifest` returns this
 * same reference.
 */
export const shopifyAdapterManifest: AdapterMetadata = {
  adapterKey: SHOPIFY_ADAPTER_KEY,
  platformType: SHOPIFY_PLATFORM_TYPE,
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: ['ProductMaster'],
  // Stated rather than left to "every supported capability": each later
  // capability (publisher, order source, ...) must be an operator's choice,
  // not something every new connection starts doing.
  defaultEnabledCapabilities: ['ProductMaster'],
  defaultRateLimit: SHOPIFY_DEFAULT_RATE_LIMIT,
  // Shopify's budget is per app and store, so connections to one store share one bucket.
  resolveRateLimitBucketKey: resolveShopifyRateLimitBucketKey,
  displayName: 'Shopify Admin API',
  version: '0.1.0',
  isDefault: true,
};

export interface CreateShopifyPluginDeps {
  /**
   * State shared by every resolution in this process (token and throttle
   * memos) plus the OAuth write-back collaborators. Built by the Nest module;
   * a default one (no write-back) is created when absent.
   */
  readonly runtime?: ShopifyClientRuntime;
}

export function createShopifyPlugin(deps: CreateShopifyPluginDeps = {}): AdapterPlugin {
  const runtime = deps.runtime ?? createShopifyClientRuntime();
  const factory = new ShopifyAdapterFactory(runtime);

  return {
    manifest: shopifyAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyConnectionTesterAdapter(host.http, SHOPIFY_DEFAULT_RATE_LIMIT, host.cache, runtime),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyConnectionConfigShapeValidatorAdapter(SHOPIFY_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyConnectionCredentialsShapeValidatorAdapter(SHOPIFY_BRAND),
      );
      host.authFailureClassifierRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyAuthFailureClassifierAdapter(),
      );
      host.retryClassifierRegistry.register(SHOPIFY_ADAPTER_KEY, new ShopifyRetryClassifierAdapter());
      host.oauthCompletionRegistry.register(SHOPIFY_ADAPTER_KEY, new ShopifyOAuthCompletionAdapter());
    },

    createCapabilityAdapter<T>(connection: Connection, capability: string, host: HostServices): Promise<T> {
      // Dispatch FIRST, build lazily: an unsupported capability must fail with
      // the SDK's uniform "does not support" error before any credential is
      // decrypted.
      const resolve = (): Promise<ShopifyResolution> =>
        factory.resolve(
          connection,
          host.credentialsResolver,
          host.http.forConnection(connection, SHOPIFY_DEFAULT_RATE_LIMIT, {
            bucketKey: resolveShopifyRateLimitBucketKey(connection),
          }),
          host.cache,
        );
      try {
        return dispatchCapability<Promise<T>>(
          capability,
          {
            ProductMaster: async () =>
              factory.createProductMaster(await resolve(), host.identifierMapping, host.cache) as T,
          },
          SHOPIFY_BRAND,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
