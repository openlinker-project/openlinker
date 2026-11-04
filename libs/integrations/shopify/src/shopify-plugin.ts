/**
 * Shopify Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the Shopify Admin GraphQL API.
 * PROTOTYPE for spike #3928: built to run the spike's end-to-end scenarios
 * against a dev store, never to be merged.
 *
 * Registers the connection tester, the config + credentials shape validators,
 * the retry and auth-failure classifiers and the orders-poll task, and
 * dispatches four capabilities: `ProductMaster`, `InventoryMaster`,
 * `OrderSource` and `OrderProcessorManager` (with its `OrderFulfillmentUpdater`
 * / `OrderStatusWriteback` / `OrderCreateStockEffect` sub-capabilities,
 * narrowed at the call site and never dispatched by name).
 *
 * Every outbound call - the token mint included - goes through
 * `host.http.forConnection` with `SHOPIFY_DEFAULT_RATE_LIMIT`.
 *
 * Out of scope: webhooks, ProductPublisher, returns.
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
import { ShopifyAdapterFactory, type ShopifyAdapters } from './application/shopify-adapter.factory';
import type { ShopifyTokenMemo } from './infrastructure/http/shopify-client.builder';
import { ShopifyAuthFailureClassifierAdapter } from './infrastructure/adapters/shopify-auth-failure-classifier.adapter';
import { ShopifyConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/shopify-connection-config-shape-validator.adapter';
import { ShopifyConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/shopify-connection-credentials-shape-validator.adapter';
import { ShopifyConnectionTesterAdapter } from './infrastructure/adapters/shopify-connection-tester.adapter';
import { ShopifyRetryClassifierAdapter } from './infrastructure/adapters/shopify-retry-classifier.adapter';
import { buildShopifySchedulerTasks } from './infrastructure/scheduler/shopify-scheduler-tasks';

/**
 * Static plugin manifest (#575); `createShopifyPlugin().manifest` returns this
 * same reference. A capability name enters `supportedCapabilities` together
 * with the adapter that delivers it.
 */
export const shopifyAdapterManifest: AdapterMetadata = {
  adapterKey: SHOPIFY_ADAPTER_KEY,
  platformType: SHOPIFY_PLATFORM_TYPE,
  supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
  // Catalogue and stock only by default, the Shoper reasoning: ingesting
  // orders is polling load, and `OrderProcessorManager` would make OpenLinker
  // fan every ingested order out into this shop. Both are opt-in.
  defaultEnabledCapabilities: ['ProductMaster', 'InventoryMaster'],
  defaultRateLimit: SHOPIFY_DEFAULT_RATE_LIMIT,
  displayName: 'Shopify Admin API',
  version: '0.1.0',
  isDefault: true,
};

/** Kept for source compatibility with the scaffold; the plugin needs no Nest-provided deps. */
export type CreateShopifyPluginDeps = Record<string, never>;

export function createShopifyPlugin(_deps: CreateShopifyPluginDeps = {}): AdapterPlugin {
  // One token memo and one factory for the plugin's lifetime: minted tokens
  // outlive the per-call adapter bags.
  const tokenMemo: ShopifyTokenMemo = new Map();
  const factory = new ShopifyAdapterFactory(tokenMemo);

  return {
    manifest: shopifyAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        SHOPIFY_ADAPTER_KEY,
        new ShopifyConnectionTesterAdapter(host.http, SHOPIFY_DEFAULT_RATE_LIMIT, host.cache, tokenMemo),
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
      for (const task of buildShopifySchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    createCapabilityAdapter<T>(connection: Connection, capability: string, host: HostServices): Promise<T> {
      // Dispatch FIRST, build lazily: an unsupported capability must fail with
      // the SDK's uniform error before any credential is decrypted.
      const build = async (): Promise<ShopifyAdapters> =>
        factory.createAdapters(
          connection,
          host.identifierMapping,
          host.credentialsResolver,
          host.http.forConnection(connection, shopifyAdapterManifest.defaultRateLimit),
          host.cache,
        );
      try {
        return dispatchCapability<Promise<T>>(
          capability,
          {
            ProductMaster: async () => (await build()).productMaster,
            InventoryMaster: async () => (await build()).inventoryMaster,
            OrderSource: async () => (await build()).orderSource,
            OrderProcessorManager: async () => (await build()).orderProcessor,
          },
          SHOPIFY_BRAND,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
