/**
 * Mirakl Product Media Reader
 *
 * The catalogue card pictures of the seller's offers, read from P11
 * (`GET /api/products/offers`) by `product_sku` (#4284). OF21 carries no media,
 * so the catalogue master asks P11 for the cards of the offers it maps, at most
 * {@link MIRAKL_P11_MAX_PRODUCT_IDS} per call.
 *
 * Each card is remembered for the life of this reader (one adapter build), so a
 * product read twice in one job costs one call. A failed call is not swallowed:
 * reporting "no images" would clear the pictures OpenLinker already holds, so
 * the read fails and the sync job retries.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import { readMiraklProductImages } from '../../../domain/policies/mirakl-product-media.policy';
import type { MiraklProductsWithOffersPage } from '../../../domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';

const PRODUCTS_WITH_OFFERS_PATH = '/api/products/offers';

/** How many `product_ids` one P11 call takes. */
export const MIRAKL_P11_MAX_PRODUCT_IDS = 100;

export class MiraklProductMediaReader {
  private readonly memo = new Map<string, readonly string[]>();

  constructor(private readonly httpClient: IMiraklHttpClient) {}

  /** Picture urls per `product_sku`; a card without pictures maps to `[]`. */
  async imagesFor(productSkus: readonly string[]): Promise<Map<string, readonly string[]>> {
    const wanted = [...new Set(productSkus.map((sku) => sku.trim()).filter(Boolean))];
    const missing = wanted.filter((sku) => !this.memo.has(sku));
    for (let start = 0; start < missing.length; start += MIRAKL_P11_MAX_PRODUCT_IDS) {
      await this.readBatch(missing.slice(start, start + MIRAKL_P11_MAX_PRODUCT_IDS));
    }
    return new Map(wanted.map((sku) => [sku, this.memo.get(sku) ?? []]));
  }

  private async readBatch(skus: readonly string[]): Promise<void> {
    const { data } = await this.httpClient.get<MiraklProductsWithOffersPage>(
      PRODUCTS_WITH_OFFERS_PATH,
      { queryParams: { product_ids: skus.join(',') } }
    );
    for (const sku of skus) {
      this.memo.set(sku, []);
    }
    for (const product of data?.products ?? []) {
      if (product.product_sku && this.memo.has(product.product_sku)) {
        this.memo.set(product.product_sku, readMiraklProductImages(product.product_media));
      }
    }
  }
}
