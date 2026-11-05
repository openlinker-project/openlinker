/**
 * Shopify Adapter Factory
 *
 * Per-connection factory for the Shopify capability adapters. Resolves the
 * connection's config and credentials, builds ONE GraphQL client over the
 * connection-bound transport, and constructs every adapter on top of it.
 * Credentials are resolved here, per call - never cached across connections.
 *
 * `getCapabilityAdapter` builds a fresh bag on every call, so the two things
 * worth keeping between calls live outside the bag: the minted access token
 * (the factory's memo plus the host cache) and the shop context with the
 * resolved location (host cache, see `ShopifyShopContextProvider`).
 *
 * @module libs/integrations/shopify/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { ShopifyOfferManagerAdapter } from '../infrastructure/adapters/offer-manager/shopify-offer-manager.adapter';
import { ShopifyInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/shopify-inventory-master.adapter';
import { ShopifyOrderProcessorAdapter } from '../infrastructure/adapters/order-processor/shopify-order-processor.adapter';
import {
  ShopifyOrderSourceAdapter,
  ShopifyRefundingOrderSourceAdapter,
} from '../infrastructure/adapters/order-source/shopify-order-source.adapter';
import { ShopifyRefundExecutor } from '../infrastructure/adapters/order-source/shopify-refund-executor';
import { ShopifyProductMasterAdapter } from '../infrastructure/adapters/product-master/shopify-product-master.adapter';
import { ShopifyProductPublisherAdapter } from '../infrastructure/adapters/product-publisher/shopify-product-publisher.adapter';
import { buildShopifyClient, type ShopifyTokenMemo } from '../infrastructure/http/shopify-client.builder';
import { ShopifyProductReader } from '../infrastructure/readers/shopify-product.reader';
import { ShopifyShopContextProvider } from '../infrastructure/shop-context/shopify-shop-context.provider';
import type { IShopifyAdapterFactory, ShopifyAdapters } from './interfaces/shopify-adapter.factory.interface';

export type { ShopifyAdapters } from './interfaces/shopify-adapter.factory.interface';

export class ShopifyAdapterFactory implements IShopifyAdapterFactory {
  constructor(
    private readonly tokenMemo: ShopifyTokenMemo,
    private readonly mappingConfig?: () => IMappingConfigService | undefined,
  ) {}

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<ShopifyAdapters> {
    const { config, client } = await buildShopifyClient(
      connection,
      credentialsResolver,
      fetchImpl,
      cache,
      this.tokenMemo,
    );
    const shopContext = new ShopifyShopContextProvider(client, connection.id, config.locationGid, cache);
    const orderProcessor = new ShopifyOrderProcessorAdapter(
      client,
      identifierMapping,
      shopContext,
      connection,
      this.mappingConfig,
    );

    return {
      productMaster: new ShopifyProductMasterAdapter(
        client,
        identifierMapping,
        shopContext,
        new ShopifyProductReader(client, connection.id),
        connection,
      ),
      inventoryMaster: new ShopifyInventoryMasterAdapter(
        client,
        identifierMapping,
        shopContext,
        connection,
        cache,
      ),
      // Refunds through Shopify are opt-in: the method's presence is what makes
      // core move money instead of recording an out-of-band refund.
      orderSource: config.refundsThroughShopify
        ? new ShopifyRefundingOrderSourceAdapter(
            client,
            config.storeDomain,
            connection,
            orderProcessor,
            new ShopifyRefundExecutor(client, connection.id),
          )
        : new ShopifyOrderSourceAdapter(client, config.storeDomain, connection, orderProcessor),
      orderProcessor,
      productPublisher: new ShopifyProductPublisherAdapter(client, shopContext, connection),
      offerManager: new ShopifyOfferManagerAdapter(client, identifierMapping, shopContext, connection),
    };
  }
}
