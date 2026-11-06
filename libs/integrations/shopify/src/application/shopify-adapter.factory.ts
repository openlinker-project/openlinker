/**
 * Shopify Adapter Factory
 *
 * Per-connection factory: resolves the connection's config and credentials
 * and builds ONE GraphQL client over the connection-bound transport, plus the
 * shop context. Credentials are resolved per call, never cached across
 * connections. What must outlive a resolution (the minted token, the throttle
 * observation) lives in the plugin's `ShopifyClientRuntime` and the host cache.
 *
 * No capability adapter is built yet: each enters together with its adapter
 * in a follow-up issue, constructed from the `ShopifyResolution` built here.
 *
 * @module libs/integrations/shopify/src/application
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { buildShopifyClient, type ShopifyClientRuntime } from '../infrastructure/http/shopify-client.builder';
import { ShopifyShopContextProvider } from '../infrastructure/shop-context/shopify-shop-context.provider';
import type { IShopifyAdapterFactory, ShopifyResolution } from './interfaces/shopify-adapter.factory.interface';

export type { ShopifyResolution } from './interfaces/shopify-adapter.factory.interface';

export class ShopifyAdapterFactory implements IShopifyAdapterFactory {
  constructor(private readonly runtime: ShopifyClientRuntime) {}

  async resolve(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<ShopifyResolution> {
    const { config, client } = await buildShopifyClient(
      connection,
      credentialsResolver,
      fetchImpl,
      cache,
      this.runtime,
    );
    return {
      connection,
      config,
      client,
      shopContext: new ShopifyShopContextProvider(client, connection.id, config.locationGid, cache),
    };
  }
}
