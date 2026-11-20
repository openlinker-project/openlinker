/**
 * Shopify Inventory Reader
 *
 * A product's variants with their level at the ONE configured location,
 * through a memo shared by the InventoryMaster adapter of a resolution. It is
 * the inventory twin of `ShopifyProductReader` and applies the same deletion
 * rule, so the two masters cannot disagree about whether a product exists:
 * `product: null` and `status: ARCHIVED` raise `MasterProductNotFoundError`;
 * a transport, auth or throttle failure passes through untouched.
 *
 * Variants are read 100 per page (query cost) until the product is complete.
 *
 * `forget` drops a product so a write can re-read the level it compares
 * against: a memoised level would be exactly the stale value compare-and-set
 * exists to refuse.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { toShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type {
  ShopifyInventoryProduct,
  ShopifyInventoryVariant,
} from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';
import { INVENTORY_ITEM_LEVELS_QUERY, PRODUCT_INVENTORY_QUERY } from './shopify-inventory.queries';
import { isShopifyProductWithdrawn } from './shopify-product.reader';

/** Shopify allows 2048 variants per product; past this many pages the read stops. */
const MAX_VARIANT_PAGES = 25;
/** 250 per page, so this covers Shopify's own location ceiling several times over. */
const MAX_LEVEL_PAGES = 10;

export class ShopifyInventoryReader {
  private readonly reads = new Map<string, Promise<ShopifyInventoryProduct | null>>();

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
    private readonly allLocations: boolean = false,
  ) {}

  /** Prime the memo with a product a bulk read returned; an existing entry wins. */
  seed(externalId: string, product: ShopifyInventoryProduct, locationGid: string): void {
    if (!this.reads.has(externalId)) {
      this.remember(externalId, this.complete(product, locationGid));
    }
  }

  forget(externalId: string): void {
    this.reads.delete(externalId);
  }

  /**
   * @param externalId - the numeric Shopify product id
   * @param productId - the OpenLinker internal id, carried on the neutral error
   * @param locationGid - the one location the levels are read at
   */
  async read(externalId: string, productId: string, locationGid: string): Promise<ShopifyInventoryProduct> {
    let read = this.reads.get(externalId);
    if (read === undefined) {
      read = this.client
        .query<{ product: ShopifyInventoryProduct | null }>(PRODUCT_INVENTORY_QUERY, {
          id: toShopifyGid('Product', externalId),
          locationId: locationGid,
          after: null,
          allLocations: this.allLocations,
        })
        .then((data) => (data.product === null ? null : this.complete(data.product, locationGid)));
      this.remember(externalId, read);
    }
    const product = await read;
    if (product === null || isShopifyProductWithdrawn(product)) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    return product;
  }

  private remember(externalId: string, read: Promise<ShopifyInventoryProduct | null>): void {
    this.reads.set(externalId, read);
    read.catch(() => this.reads.delete(externalId));
  }

  private async complete(
    product: ShopifyInventoryProduct,
    locationGid: string,
  ): Promise<ShopifyInventoryProduct> {
    const withLevels = this.allLocations ? await this.completeLevels(product) : product;
    let pageInfo = withLevels.variants.pageInfo;
    if (pageInfo?.hasNextPage !== true) {
      return withLevels;
    }
    product = withLevels;
    const variants: ShopifyInventoryVariant[] = [...product.variants.nodes];
    for (let page = 0; page < MAX_VARIANT_PAGES && pageInfo?.hasNextPage === true; page += 1) {
      const data: { product: ShopifyInventoryProduct | null } = await this.client.query(
        PRODUCT_INVENTORY_QUERY,
        { id: product.id, locationId: locationGid, after: pageInfo.endCursor, allLocations: this.allLocations },
      );
      if (data.product === null) {
        // Deleted between the two reads: the first page already answered, the
        // next sync sees the deletion.
        break;
      }
      const more = this.allLocations ? await this.completeLevels(data.product) : data.product;
      variants.push(...more.variants.nodes);
      pageInfo = data.product.variants.pageInfo;
    }
    return { ...product, variants: { nodes: variants, pageInfo } };
  }

  /**
   * Pages the levels of every item whose nested first page was full, so a shop
   * with more locations than the nested page holds is read completely instead
   * of in part. A follow-up is one cheap single-item query (cost is paid only
   * by items that need it); an item still having pages after `MAX_LEVEL_PAGES`
   * keeps `hasNextPage: true`, which the adapter reads as "location set not
   * complete" and so never prunes off it.
   */
  private async completeLevels(product: ShopifyInventoryProduct): Promise<ShopifyInventoryProduct> {
    const nodes = await Promise.all(
      product.variants.nodes.map(async (variant) => {
        const first = variant.inventoryItem.levels;
        if (first?.pageInfo?.hasNextPage !== true) {
          return variant;
        }
        const all = [...first.nodes];
        let pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null } | undefined =
          first.pageInfo;
        for (let page = 0; page < MAX_LEVEL_PAGES && pageInfo?.hasNextPage === true; page += 1) {
          const data: { inventoryItem: { levels: NonNullable<typeof first> } | null } =
            await this.client.query(INVENTORY_ITEM_LEVELS_QUERY, {
              id: variant.inventoryItem.id,
              after: pageInfo.endCursor,
            });
          if (!data.inventoryItem) {
            break;
          }
          all.push(...data.inventoryItem.levels.nodes);
          pageInfo = data.inventoryItem.levels.pageInfo;
        }
        return {
          ...variant,
          inventoryItem: { ...variant.inventoryItem, levels: { nodes: all, pageInfo } },
        };
      }),
    );
    return { ...product, variants: { ...product.variants, nodes } };
  }
}
