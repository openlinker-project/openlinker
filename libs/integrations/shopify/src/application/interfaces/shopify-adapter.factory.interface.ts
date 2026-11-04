/**
 * Shopify Adapter Factory Interface
 *
 * The per-connection bag of Shopify capability adapters, and the factory
 * contract that builds it.
 *
 * @module libs/integrations/shopify/src/application/interfaces
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import type { ShopifyInventoryMasterAdapter } from '../../infrastructure/adapters/inventory-master/shopify-inventory-master.adapter';
import type { ShopifyOrderProcessorAdapter } from '../../infrastructure/adapters/order-processor/shopify-order-processor.adapter';
import type { ShopifyOrderSourceAdapter } from '../../infrastructure/adapters/order-source/shopify-order-source.adapter';
import type { ShopifyProductMasterAdapter } from '../../infrastructure/adapters/product-master/shopify-product-master.adapter';
import type { ShopifyProductPublisherAdapter } from '../../infrastructure/adapters/product-publisher/shopify-product-publisher.adapter';

export interface ShopifyAdapters {
  readonly productMaster: ShopifyProductMasterAdapter;
  readonly inventoryMaster: ShopifyInventoryMasterAdapter;
  readonly orderSource: ShopifyOrderSourceAdapter;
  readonly orderProcessor: ShopifyOrderProcessorAdapter;
  readonly productPublisher: ShopifyProductPublisherAdapter;
}

export interface IShopifyAdapterFactory {
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
  ): Promise<ShopifyAdapters>;
}
