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
 * here; each enters together with its issue (ProductMaster: #3975,
 * InventoryMaster: #3976, OrderSource: #3977, OrderProcessorManager: #3978).
 *
 * @module libs/integrations/shopify/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { InventoryMasterPort } from '@openlinker/core/inventory';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { ShopProductManagerPort } from '@openlinker/core/listings';
import type { OrderProcessorManagerPort, OrderSourcePort } from '@openlinker/core/orders';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import {
  ShopifyOrderSourceAdapter,
  ShopifyRefundingOrderSourceAdapter,
} from '../infrastructure/adapters/order-source/shopify-order-source.adapter';
import { ShopifyRefundExecutor } from '../infrastructure/adapters/order-source/shopify-refund-executor';
import { ShopifyOrderProcessorAdapter } from '../infrastructure/adapters/order-processor/shopify-order-processor.adapter';
import { ShopifyOrderStatusWriteback } from '../infrastructure/adapters/order-status/shopify-order-status-writeback';
import { ShopifyInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/shopify-inventory-master.adapter';
import { ShopifyProductMasterAdapter } from '../infrastructure/adapters/product-master/shopify-product-master.adapter';
import { ShopifyProductPublisherAdapter } from '../infrastructure/adapters/product-publisher/shopify-product-publisher.adapter';
import { buildShopifyClient, type ShopifyClientRuntime } from '../infrastructure/http/shopify-client.builder';
import { ShopifyInventoryReader } from '../infrastructure/readers/shopify-inventory.reader';
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

  createInventoryMaster(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    cache?: CachePort,
  ): InventoryMasterPort {
    const { client, connection, config, shopContext } = resolution;
    return new ShopifyInventoryMasterAdapter(
      client,
      identifierMapping,
      shopContext,
      new ShopifyInventoryReader(client, connection.id),
      connection,
      config.unmanagedStockQuantity,
      cache,
    );
  }

  createOrderSource(resolution: ShopifyResolution): OrderSourcePort {
    const { client, connection, config, shopContext } = resolution;
    const writeback = new ShopifyOrderStatusWriteback(client, shopContext, connection);
    // A separate class rather than a flag: core finds `RefundExecutor` by the
    // method's presence, so a connection that did not opt in must not have it.
    return config.refundsThroughShopify
      ? new ShopifyRefundingOrderSourceAdapter(
          client,
          config.storeDomain,
          connection,
          writeback,
          new ShopifyRefundExecutor(client, connection.id),
        )
      : new ShopifyOrderSourceAdapter(client, config.storeDomain, connection, writeback);
  }

  createOrderProcessor(
    resolution: ShopifyResolution,
    identifierMapping: IdentifierMappingPort,
    mappingConfig?: IMappingConfigService,
  ): OrderProcessorManagerPort {
    const { client, connection, shopContext } = resolution;
    return new ShopifyOrderProcessorAdapter(
      client,
      identifierMapping,
      shopContext,
      connection,
      new ShopifyOrderStatusWriteback(client, shopContext, connection),
      mappingConfig,
    );
  }

  createProductPublisher(resolution: ShopifyResolution, cache?: CachePort): ShopProductManagerPort {
    const { client, connection, config, shopContext } = resolution;
    return new ShopifyProductPublisherAdapter(
      client,
      shopContext,
      connection,
      new ShopifyTaxRateReader(client, shopContext, connection.id, config.salesCountryIso2, cache),
    );
  }
}
