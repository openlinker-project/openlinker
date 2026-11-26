/**
 * Amazon Listing Reader (#4182)
 *
 * The seller's own listings, read for the catalogue (Listings Items API
 * v2021-08-01):
 *
 *   - `read(sku)`: one listing with attributes, summaries, offers and
 *     relationships, served from a per-instance cache that `prefetch` fills
 *     with `searchListingsItems(identifiersType=SKU)`, 20 SKUs a call. Only
 *     a `getListingsItem` 404 caches a listing as gone; a search miss does not.
 *   - `page(index)`: one page of `searchListingsItems`, ordered by SKU.
 *     Amazon pages with a token, never an offset, so the token that opens
 *     each page is remembered in the host cache: page N is one call once
 *     page N-1 was read, instead of N calls from the start. Without a cache
 *     (or after it expired) the walk restarts from the first page.
 *
 * A listing Amazon no longer has raises the core `MasterProductNotFoundError`
 * at the caller, which owns the product id.
 *
 * @module libs/integrations/amazon/src/infrastructure/readers
 */
import type { CachePort } from '@openlinker/shared';

import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import type { AmazonListingItem, AmazonListingSearchResults } from '../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient, AmazonSpApiResponse } from '../http/amazon-spapi-client';

const LISTINGS_PATH = '/listings/2021-08-01/items';
/** `searchListingsItems` returns at most 20 items a page and takes at most 20 identifiers. */
export const AMAZON_LISTING_PAGE_SIZE = 20;
const FULL_DATA = ['summaries', 'attributes', 'offers', 'relationships', 'fulfillmentAvailability'];
/** A page token is reused within one catalogue cycle; past this it is read again. */
const PAGE_TOKEN_TTL_SECONDS = 6 * 3_600;

export interface AmazonListingPageQuery {
  /** `lastUpdatedAfter`, ISO 8601: only listings changed since. */
  readonly lastUpdatedAfter?: string;
}

export class AmazonListingReader {
  private readonly cached = new Map<string, AmazonListingItem | null>();

  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly sellerId: string,
    private readonly marketplaceId: string,
    private readonly connectionId: string,
    private readonly cache?: CachePort,
  ) {}

  /** The listing under `sku`, or `null` when Amazon has none. */
  async read(sku: string): Promise<AmazonListingItem | null> {
    if (this.cached.has(sku)) {
      return this.cached.get(sku) ?? null;
    }
    return this.refresh(sku);
  }

  /**
   * Reads `sku` from Amazon even when cached: a stock write starts from Amazon's
   * current quantity (#4183). `withIssues` also asks for the listing's issues,
   * which is how a patch Amazon accepted and then failed shows (#4183 review).
   */
  async refresh(sku: string, options: { readonly withIssues?: boolean } = {}): Promise<AmazonListingItem | null> {
    try {
      const response = await this.client.get<AmazonListingItem>(
        `${LISTINGS_PATH}/${encodeURIComponent(this.sellerId)}/${encodeURIComponent(sku)}`,
        {
          marketplaceIds: [this.marketplaceId],
          includedData: options.withIssues === true ? [...FULL_DATA, 'issues'] : FULL_DATA,
        },
      );
      this.cached.set(sku, response.data);
      return response.data;
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 404) {
        this.cached.set(sku, null);
        return null;
      }
      throw error;
    }
  }

  /**
   * Reads up to 20 SKUs per call into the cache. An SKU the search did not
   * return is NOT cached as absent: a search answer can omit a listing that
   * exists (index lag on a fresh listing), and an absence read as a deletion
   * would retire the product's variants and pause its offers everywhere
   * (#1689). Such an SKU stays unread, so the caller's `read` asks
   * `getListingsItem`, whose 404 is the only answer taken as "gone". The
   * prefetch is a request-count optimisation and changes no outcome.
   */
  async prefetch(skus: readonly string[]): Promise<void> {
    for (let start = 0; start < skus.length; start += AMAZON_LISTING_PAGE_SIZE) {
      const batch = skus.slice(start, start + AMAZON_LISTING_PAGE_SIZE);
      const response = await this.client.get<AmazonListingSearchResults>(
        `${LISTINGS_PATH}/${encodeURIComponent(this.sellerId)}`,
        {
          marketplaceIds: [this.marketplaceId],
          identifiers: batch,
          identifiersType: 'SKU',
          includedData: FULL_DATA,
          pageSize: AMAZON_LISTING_PAGE_SIZE,
        },
      );
      for (const item of response.data.items) {
        if (batch.includes(item.sku)) this.cached.set(item.sku, item);
      }
    }
  }

  /** The cached listing under `sku`, without a call: `undefined` when not read yet. */
  peek(sku: string): AmazonListingItem | null | undefined {
    return this.cached.get(sku);
  }

  /** Puts already-read listings in the cache (a page read carries full data). */
  seed(items: readonly AmazonListingItem[]): void {
    for (const item of items) {
      this.cached.set(item.sku, item);
    }
  }

  /**
   * Page `index` (0-based) of the seller's listings, SKU order; `null` past
   * the last page.
   */
  async page(index: number, query: AmazonListingPageQuery = {}): Promise<AmazonListingItem[] | null> {
    let token: string | null | undefined = index === 0 ? null : await this.tokenFor(index, query);
    let at = index;
    if (token === undefined) {
      // Walk from the nearest page whose token is known (or the first).
      at = 0;
      token = null;
      for (let probe = index - 1; probe > 0; probe -= 1) {
        const known = await this.tokenFor(probe, query);
        if (known !== undefined) {
          at = probe;
          token = known;
          break;
        }
      }
    }
    for (;;) {
      if (at > 0 && token === null) {
        return null;
      }
      const response: AmazonSpApiResponse<AmazonListingSearchResults> = await this.client.get<AmazonListingSearchResults>(
        `${LISTINGS_PATH}/${encodeURIComponent(this.sellerId)}`,
        {
          marketplaceIds: [this.marketplaceId],
          includedData: FULL_DATA,
          sortBy: 'sku',
          sortOrder: 'ASC',
          pageSize: AMAZON_LISTING_PAGE_SIZE,
          ...(query.lastUpdatedAfter ? { lastUpdatedAfter: query.lastUpdatedAfter } : {}),
          ...(token ? { pageToken: token } : {}),
        },
      );
      const next: string | null = response.data.pagination?.nextToken ?? null;
      await this.rememberToken(at + 1, query, next);
      this.seed(response.data.items);
      if (at === index) {
        return [...response.data.items];
      }
      at += 1;
      token = next;
    }
  }

  private tokenKey(index: number, query: AmazonListingPageQuery): string {
    return `amazon:listing-page:${this.connectionId}:${query.lastUpdatedAfter ?? 'all'}:${index}`;
  }

  /** The token opening page `index`: a string, `null` when there is no such page, `undefined` when unknown. */
  private async tokenFor(index: number, query: AmazonListingPageQuery): Promise<string | null | undefined> {
    if (this.cache === undefined) {
      return undefined;
    }
    const value = await this.cache.get<{ token: string | null }>(this.tokenKey(index, query)).catch(() => null);
    return value === null || value === undefined ? undefined : value.token;
  }

  private async rememberToken(index: number, query: AmazonListingPageQuery, token: string | null): Promise<void> {
    await this.cache?.set(this.tokenKey(index, query), { token }, PAGE_TOKEN_TTL_SECONDS).catch(() => undefined);
  }
}
