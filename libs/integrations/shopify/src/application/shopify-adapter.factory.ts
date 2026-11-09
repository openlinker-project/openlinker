/**
 * Shopify Adapter Factory
 *
 * Per-connection factory: resolves the connection's config and credentials
 * and builds ONE GraphQL client over the connection-bound transport, plus the
 * shop context. Credentials are resolved per call, never cached across
 * connections. What must outlive a resolution (the minted token, the throttle
 * observation) lives in the plugin's `ShopifyClientRuntime` and the host cache.
 *
 * Capability adapters are constructed from the `ShopifyResolution` built
 * here; each enters together with its issue (ProductMaster: #3975).
 *
 * @module libs/integrations/shopify/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { ShopifyProductMasterAdapter } from '../infrastructure/adapters/product-master/shopify-product-master.adapter';
import { buildShopifyClient, type ShopifyClientRuntime } from '../infrastructure/http/shopify-client.builder';
import { ShopifyProductReader } from '../infrastructure/readers/shopify-product.reader';
import { ShopifyTaxRateReader } from '../infrastructure/tax/shopify-tax-rate.reader';
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

  createProductMaster(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): ProductMasterPort {
    const { client, connection, config, shopContext } = resolution;
    return new ShopifyProductMasterAdapter(
      client,
      identifierMapping,
      shopContext,
      new ShopifyProductReader(client, connection.id),
      new ShopifyTaxRateReader(client, shopContext, connection.id, config.salesCountryIso2, cache),
      connection,
      cache,
    );
  }
}
