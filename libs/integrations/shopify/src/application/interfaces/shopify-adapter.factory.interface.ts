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
import type { InventoryMasterPort } from '@openlinker/core/inventory';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { OfferManagerPort, ShopProductManagerPort } from '@openlinker/core/listings';
import type { OrderProcessorManagerPort, OrderSourcePort } from '@openlinker/core/orders';
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

  /** The InventoryMaster of one resolution (the connection's one location). */
  createInventoryMaster(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): InventoryMasterPort;

  /**
   * The OrderSource of one resolution: orders, returns, mapping options and
   * the status writeback, plus `RefundExecutor` when the connection opts in.
   */
  createOrderSource(resolution: ShopifyResolution): OrderSourcePort;

  /**
   * The order destination of one resolution (#3978). `mappingConfig` resolves
   * the source connection's delivery and payment mappings; absent, the source's
   * own words are used.
   */
  createOrderProcessor(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    mappingConfig?: IMappingConfigService,
  ): OrderProcessorManagerPort;

  /**
   * The publish destination of one resolution (#3979): `ProductPublisher`
   * plus its narrowed sub-capabilities (category provisioning and browse,
   * attributes, currency, price-only updates).
   */
  createProductPublisher(resolution: ShopifyResolution, cache?: CachePort): ShopProductManagerPort;

  /** Stock write-back to products this connection published (#3980). */
  createOfferManager(resolution: ShopifyResolution, identifierMapping: IdentifierMappingPort): OfferManagerPort;
}
