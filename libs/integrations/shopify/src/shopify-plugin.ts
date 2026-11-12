/**
 * Shopify Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shopify Admin GraphQL API
 * (2026-10). This is the plugin foundation (#3974): it registers the
 * connection tester, the config + credentials shape validators, the retry
 * and auth-failure classifiers, and the OAuth completion adapter (a store in
 * another organization installs the app through the authorization-code
 * grant). Capabilities enter `supportedCapabilities` together with the adapter
 * that delivers them (the #980 rule); ProductMaster arrived with #3975,
 * InventoryMaster with #3976, OrderSource with #3977 (with its scheduler
 * tasks: the orders poll, and the two returns passes, off by default) and
 * OrderProcessorManager with #3978. Inbound webhooks (#3981) register a
 * decoder and a translator here and a provisioner in the module. Their rungs (`ModifiedProductLister`,
 * `BulkProductReader`, `ProductTaxRateReader`, `BulkInventoryReader`) are
 * guard-only (never in the manifest), narrowed off the dispatched adapter.
 *
 * Outbound pacing: every call goes through `host.http.forConnection` with
 * `SHOPIFY_DEFAULT_RATE_LIMIT` and the STORE's shared bucket (Shopify's
 * budget is per app and store, ADR-038 § Amendment); query cost is paced by
 * the GraphQL client from Shopify's own `throttleStatus`.
 *
 * Two pieces need collaborators `HostServices` does not carry, so
 * `ShopifyIntegrationModule` supplies them: the OAuth token write-back
 * (credentials service + lock) and the mapping config service the order
 * processor resolves a source's delivery and payment mappings with, both
 * passed in through `CreateShopifyPluginDeps`, the archive hook and the webhook
 * provisioner (both registered on the core registries directly).
 *
 * @module libs/integrations/shopify/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata, WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';

import {
  SHOPIFY_ADAPTER_KEY,
  SHOPIFY_BRAND,
  SHOPIFY_DEFAULT_RATE_LIMIT,
  SHOPIFY_PLATFORM_TYPE,
} from './shopify.constants';
import { ShopifyAdapterFactory, type ShopifyResolution } from './application/shopify-adapter.factory';
import { resolveShopifyRateLimitBucketKey } from './domain/policies/shopify-rate-limit-bucket.policy';
import { ShopifyInboundWebhookDecoderAdapter } from './infrastructure/adapters/webhooks/shopify-inbound-webhook-decoder.adapter';
import { ShopifyWebhookEventTranslatorAdapter } from './infrastructure/adapters/webhooks/shopify-webhook-event-translator.adapter';
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
import { buildShopifySchedulerTasks } from './infrastructure/scheduler/shopify-scheduler-tasks';

/**
 * Static plugin manifest (#575); `createShopifyPlugin().manifest` returns this
 * same reference.
 */
export const shopifyAdapterManifest: AdapterMetadata = {
  adapterKey: SHOPIFY_ADAPTER_KEY,
  platformType: SHOPIFY_PLATFORM_TYPE,
  // A capability name enters this list together with the adapter that delivers it.
  supportedCapabilities: [
    'ProductMaster',
    'InventoryMaster',
    'OrderSource',
    'OrderProcessorManager',
    // Advertised-without-dispatch sub-capabilities of the order source, for
    // host discovery only; resolved by narrowing the dispatched `OrderSource`
    // adapter with their guards, never through `getCapabilityAdapter`.
    'ReturnSourceReader',
    'ReturnDecliner',
  ],
  // Stated rather than left to "every supported capability": `OrderSource` is
  // opt-in, because ingesting a shop's orders is polling load against the
  // store's request budget and creates those orders in every destination - a
  // connection meant only as a catalogue and stock master must not start it.
  // `OrderProcessorManager` is opt-in for the same reason in reverse: it makes
  // the store receive every marketplace order (the Shoper precedent).
  defaultEnabledCapabilities: ['ProductMaster', 'InventoryMaster'],
  // Shopify signs every webhook with the app client secret, which OpenLinker
  // can only store, never rotate (#3981).
  acceptsCallerSuppliedWebhookSecret: true,
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
  /**
   * Resolves a source connection's delivery and payment mappings for the
   * order processor (#3978). Absent, an order is created with the source's
   * own method names.
   */
  readonly mappingConfigService?: IMappingConfigService;
  /**
   * Reads the stored webhook secret, so the connection test can tell when it no
   * longer matches the app client secret (#3981). Absent, that check is skipped.
   */
  readonly webhookSecrets?: WebhookSecretProviderPort;
}

export function createShopifyPlugin(deps: CreateShopifyPluginDeps = {}): AdapterPlugin {
  const runtime = deps.runtime ?? createShopifyClientRuntime();
  const factory = new ShopifyAdapterFactory(runtime);

  return {
    manifest: shopifyAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyConnectionTesterAdapter(host.http, SHOPIFY_DEFAULT_RATE_LIMIT, host.cache, runtime, deps.webhookSecrets),
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
      // Inbound webhooks (#3981). The decoder is keyed by PLATFORM TYPE (the
      // `:provider` segment of the delivery route), the translator by adapter
      // key. The provisioner is registered by `ShopifyIntegrationModule`: it
      // needs `ConnectionPort` and `IWebhookSecretService`.
      host.inboundWebhookDecoderRegistry.register(
        SHOPIFY_PLATFORM_TYPE,
        new ShopifyInboundWebhookDecoderAdapter(),
      );
      host.webhookEventTranslatorRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyWebhookEventTranslatorAdapter(),
      );
      for (const task of buildShopifySchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
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
            InventoryMaster: async () =>
              factory.createInventoryMaster(await resolve(), host.identifierMapping, host.cache) as T,
            OrderSource: async () => factory.createOrderSource(await resolve()) as T,
            OrderProcessorManager: async () =>
              factory.createOrderProcessor(
                await resolve(),
                host.identifierMapping,
                deps.mappingConfigService,
              ) as T,
          },
          SHOPIFY_BRAND,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
