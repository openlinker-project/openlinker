/**
 * Shopify Product Reader
 *
 * `product(id:)` through one memo shared by the ProductMaster adapter of a
 * resolution, and THE place a master-side deletion becomes the neutral
 * `MasterProductNotFoundError` core stales variants on (#1599). Shopify
 * reports a deleted product as `product: null` with no error, so only that
 * null counts; a transport failure, an auth failure or a throttle passes
 * through untouched, because reading any of those as a deletion would stale a
 * catalogue on an availability problem.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { toShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type { ShopifyProduct } from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';
import { PRODUCT_BY_ID_QUERY } from './shopify-product.queries';

export class ShopifyProductReader {
  private readonly reads = new Map<string, Promise<ShopifyProduct>>();

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  /** Prime the memo with a product a list read returned; an existing entry wins. */
  seed(externalId: string, product: ShopifyProduct): void {
    if (!this.reads.has(externalId)) {
      this.reads.set(externalId, Promise.resolve(product));
    }
  }

  /**
   * @param externalId - the numeric Shopify product id
   * @param productId - the OpenLinker internal id, carried on the neutral error
   */
  read(externalId: string, productId: string): Promise<ShopifyProduct> {
    let read = this.reads.get(externalId);
    if (read === undefined) {
      read = this.client
        .query<{ product: ShopifyProduct | null }>(PRODUCT_BY_ID_QUERY, {
          id: toShopifyGid('Product', externalId),
        })
        .then((data) => {
          if (data.product === null) {
            throw new MasterProductNotFoundError(productId, this.connectionId);
          }
          return data.product;
        });
      this.reads.set(externalId, read);
      read.catch(() => this.reads.delete(externalId));
    }
    return read;
  }
}
