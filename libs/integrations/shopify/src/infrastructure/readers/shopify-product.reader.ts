/**
 * Shopify Product Reader
 *
 * `product(id:)` through one memo shared by the ProductMaster adapter of a
 * resolution, and THE place a product becomes the neutral
 * `MasterProductNotFoundError` core stales variants on (#1599):
 *
 *   - `product: null` - Shopify reports a deleted product so, with no error
 *     (case A10);
 *   - `status: ARCHIVED` - withdrawn from sale (decision on #3975, case A11),
 *     so its offers pause; set back to ACTIVE, the next sync restores it.
 *
 * A transport failure, an auth failure or a throttle passes through untouched:
 * reading any of those as a deletion would stale a catalogue on an
 * availability problem.
 *
 * A product with more variants than the first page (`SHOPIFY_FIRST_VARIANTS`)
 * has the rest read page by page here, so every caller sees the whole product.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { toShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type {
  ShopifyConnection,
  ShopifyProduct,
  ShopifyVariant,
} from '../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';
import { PRODUCT_BY_ID_QUERY, PRODUCT_VARIANTS_PAGE_QUERY } from './shopify-product.queries';

/** Shopify allows 2048 variants per product; past this many pages the read stops. */
const MAX_VARIANT_PAGES = 30;

export const SHOPIFY_ARCHIVED_STATUS = 'ARCHIVED';

/** Whether a product counts as removed from sale (see the header). */
export function isShopifyProductWithdrawn(product: Pick<ShopifyProduct, 'status'>): boolean {
  return product.status === SHOPIFY_ARCHIVED_STATUS;
}

export class ShopifyProductReader {
  private readonly reads = new Map<string, Promise<ShopifyProduct | null>>();

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  /** Prime the memo with a product a list or bulk read returned; an existing entry wins. */
  seed(externalId: string, product: ShopifyProduct): void {
    if (!this.reads.has(externalId)) {
      this.remember(externalId, this.completeVariants(product));
    }
  }

  /**
   * @param externalId - the numeric Shopify product id
   * @param productId - the OpenLinker internal id, carried on the neutral error
   */
  async read(externalId: string, productId: string): Promise<ShopifyProduct> {
    let read = this.reads.get(externalId);
    if (read === undefined) {
      read = this.client
        .query<{ product: ShopifyProduct | null }>(PRODUCT_BY_ID_QUERY, {
          id: toShopifyGid('Product', externalId),
        })
        .then((data) => (data.product === null ? null : this.completeVariants(data.product)));
      this.remember(externalId, read);
    }
    const product = await read;
    if (product === null || isShopifyProductWithdrawn(product)) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    return product;
  }

  private remember(externalId: string, read: Promise<ShopifyProduct | null>): void {
    this.reads.set(externalId, read);
    read.catch(() => this.reads.delete(externalId));
  }

  private async completeVariants(product: ShopifyProduct): Promise<ShopifyProduct> {
    let pageInfo = product.variants.pageInfo;
    if (pageInfo?.hasNextPage !== true) {
      return product;
    }
    const variants: ShopifyVariant[] = [...product.variants.nodes];
    for (let page = 0; page < MAX_VARIANT_PAGES && pageInfo?.hasNextPage === true; page += 1) {
      const data: { product: { variants: ShopifyConnection<ShopifyVariant> } | null } =
        await this.client.query(PRODUCT_VARIANTS_PAGE_QUERY, {
          id: product.id,
          after: pageInfo.endCursor,
        });
      if (data.product === null) {
        // Deleted between the two reads: the product read already answered,
        // so the variants seen so far stand; the next sync sees the deletion.
        break;
      }
      variants.push(...data.product.variants.nodes);
      pageInfo = data.product.variants.pageInfo;
    }
    return { ...product, variants: { nodes: variants, pageInfo } };
  }
}
