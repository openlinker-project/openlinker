/**
 * Mirakl Offer Reader
 *
 * The OF21 (`GET /api/offers`) reads the catalogue and stock masters share
 * (#4284): one offer by `shop_sku`, or one page by offset.
 *
 * OF21 has no multi-sku filter, so a batch costs one call per sku. Each read is
 * remembered for the life of this reader (one adapter build, i.e. one sync job
 * page), so `getProduct`, `getProductVariants` and `getProductCategories` for
 * the same product cost one call, not three. A page read seeds the memo too.
 * Never shared across jobs: stock read from a stale memo would undo a write.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import type { MiraklOffer, MiraklOffersPage } from '../../../domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MIRAKL_MAX_PAGE_SIZE } from '../../http/mirakl-pagination';

const OFFERS_PATH = '/api/offers';

export interface MiraklOfferPage {
  readonly offers: readonly MiraklOffer[];
  /** Offers read from OF21 on this page, with or without a `shop_sku`. */
  readonly read: number;
  readonly hasMore: boolean;
}

export class MiraklOfferReader {
  private readonly memo = new Map<string, MiraklOffer | null>();

  constructor(private readonly httpClient: IMiraklHttpClient) {}

  /**
   * The offer with exactly this `shop_sku`, or `null` when Mirakl has none.
   * `fresh` skips the memo: a stock write must read the live number.
   */
  async readBySku(sku: string, options: { fresh?: boolean } = {}): Promise<MiraklOffer | null> {
    if (!options.fresh && this.memo.has(sku)) {
      return this.memo.get(sku) ?? null;
    }
    const { data } = await this.httpClient.get<MiraklOffersPage>(OFFERS_PATH, {
      queryParams: { sku },
    });
    // OF21 may match on more than the shop sku; only an exact match is this offer.
    const offer = (data?.offers ?? []).find((candidate) => candidate.shop_sku === sku) ?? null;
    this.memo.set(sku, offer);
    return offer;
  }

  /** One page of offers, at most {@link MIRAKL_MAX_PAGE_SIZE}. */
  async readPage(offset: number, max: number): Promise<MiraklOfferPage> {
    const size = Math.max(1, Math.min(max, MIRAKL_MAX_PAGE_SIZE));
    const { data } = await this.httpClient.get<MiraklOffersPage>(OFFERS_PATH, {
      queryParams: { max: size, offset },
    });
    const offers = data?.offers ?? [];
    for (const offer of offers) {
      if (offer.shop_sku) {
        this.memo.set(offer.shop_sku, offer);
      }
    }
    const total = typeof data?.total_count === 'number' ? data.total_count : undefined;
    const read = offers.length;
    return {
      offers,
      read,
      hasMore: read === size && (total === undefined || offset + read < total),
    };
  }

  /** Forget one sku, after a write to it. */
  forget(sku: string): void {
    this.memo.delete(sku);
  }
}
