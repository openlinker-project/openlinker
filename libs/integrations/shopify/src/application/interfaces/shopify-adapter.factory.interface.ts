/**
 * Shopify Adapter Factory Interface
 *
 * What one resolution of a Shopify connection builds: the parsed config, ONE
 * GraphQL client and the shop context on top of it. The capability adapters
 * are constructed from this, so every adapter of one resolution shares one
 * client and one token.
 *
 * @module libs/integrations/shopify/src/application/interfaces
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import type { ShopifyResolvedConfig } from '../../domain/types/shopify-config.types';
import type { ShopifyGraphqlClient } from '../../infrastructure/http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../infrastructure/shop-context/shopify-shop-context.provider';

export interface ShopifyResolution {
  readonly connection: Connection;
  readonly config: ShopifyResolvedConfig;
  readonly client: ShopifyGraphqlClient;
  readonly shopContext: ShopifyShopContextProvider;
}

export interface IShopifyAdapterFactory {
  resolve(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<ShopifyResolution>;

  /** The ProductMaster of one resolution. */
  createProductMaster(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): ProductMasterPort;
}
