/**
 * Amazon Catalog Reader (#4181)
 *
 * Reads Amazon's product catalogue (Catalog Items API v2022-04-01) for the
 * publish path: a barcode (EAN) is looked up with `searchCatalogItems`
 * (`identifiersType=EAN`), an ASIN with `getCatalogItem`. Each item is reduced
 * to one marketplace's view: its title, brand, product type, EAN and images
 * (`MAIN` first).
 *
 * `searchByEans` looks up to 20 barcodes in one call (the operation's limit)
 * and splits the items back by the barcode each carries, so a batch of N
 * barcodes costs N/20 requests against a 2 req/s quota instead of N.
 *
 * A barcode shorter than 13 digits is left-padded to 13 before the search,
 * because Amazon stores EAN-13 and a 12-digit UPC is the same number with a
 * leading zero.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager
 */
import type {
  AmazonCatalogEntry,
  AmazonCatalogItem,
  AmazonCatalogSearchResults,
} from '../../../domain/types/amazon-catalog.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';

const CATALOG_PATH = '/catalog/2022-04-01/items';
const INCLUDED_DATA = ['summaries', 'images', 'identifiers', 'productTypes'] as const;
/** `searchCatalogItems` accepts up to 20 identifiers per call. */
export const CATALOG_SEARCH_MAX_IDENTIFIERS = 20;
/** The largest page `searchCatalogItems` returns. */
const SEARCH_PAGE_SIZE = 20;
/** A guard against a runaway page chain; 20 barcodes never carry 200 items in practice. */
const MAX_SEARCH_PAGES = 10;
/** Identifier types that carry a barcode comparable to an EAN-13 once normalised. */
const BARCODE_IDENTIFIER_TYPES = new Set(['EAN', 'UPC', 'GTIN']);

export class AmazonCatalogReader {
  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly marketplaceId: string,
  ) {}

  async findByEan(ean: string): Promise<AmazonCatalogEntry[]> {
    const normalized = normalizeEan(ean);
    if (normalized === null) {
      return [];
    }
    return (await this.searchByEans([normalized])).get(normalized) ?? [];
  }

  /**
   * Searches up to {@link CATALOG_SEARCH_MAX_IDENTIFIERS} normalised EANs in one
   * call, following pages, and returns the items keyed by each requested EAN.
   * Every requested EAN has an entry; an empty list means Amazon has no item
   * carrying it. In a multi-barcode search an item is matched to a barcode
   * through its own identifiers (requested via `includedData`), because the
   * response does not say which requested identifier found it.
   */
  async searchByEans(eans: readonly string[]): Promise<Map<string, AmazonCatalogEntry[]>> {
    const requested = [...new Set(eans)];
    if (requested.length > CATALOG_SEARCH_MAX_IDENTIFIERS) {
      throw new Error(`searchByEans takes at most ${CATALOG_SEARCH_MAX_IDENTIFIERS} barcodes, got ${requested.length}`);
    }
    const results = new Map<string, AmazonCatalogEntry[]>(requested.map((ean) => [ean, []]));
    if (requested.length === 0) {
      return results;
    }

    let pageToken: string | undefined;
    let pages = 0;
    do {
      const response = await this.client.get<AmazonCatalogSearchResults>(CATALOG_PATH, {
        identifiers: requested,
        identifiersType: 'EAN',
        marketplaceIds: [this.marketplaceId],
        includedData: [...INCLUDED_DATA],
        pageSize: SEARCH_PAGE_SIZE,
        ...(pageToken !== undefined ? { pageToken } : {}),
      });
      for (const item of response.data.items ?? []) {
        const entry = this.toEntry(item);
        // A single-barcode search needs no attribution: every item answers it.
        const owners = requested.length === 1 ? requested : barcodesOf(item);
        for (const ean of owners) {
          const bucket = results.get(ean);
          if (bucket !== undefined && !bucket.some((existing) => existing.asin === entry.asin)) {
            bucket.push(entry);
          }
        }
      }
      pageToken = response.data.pagination?.nextToken;
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_SEARCH_PAGES);

    if (pageToken !== undefined) {
      // A partial answer would report "no match" for barcodes on the unread pages.
      throw new Error(`Amazon catalogue search returned more than ${MAX_SEARCH_PAGES} pages`);
    }
    return results;
  }

  async getByAsin(asin: string): Promise<AmazonCatalogEntry> {
    const response = await this.client.get<AmazonCatalogItem>(`${CATALOG_PATH}/${encodeURIComponent(asin)}`, {
      marketplaceIds: [this.marketplaceId],
      includedData: [...INCLUDED_DATA],
    });
    return this.toEntry(response.data);
  }

  private toEntry(item: AmazonCatalogItem): AmazonCatalogEntry {
    const summary = pick(item.summaries, this.marketplaceId);
    const identifiers = pick(item.identifiers, this.marketplaceId)?.identifiers ?? [];
    const ean = identifiers.find((entry) => entry.identifierType === 'EAN')?.identifier ?? null;
    const images = [...(pick(item.images, this.marketplaceId)?.images ?? [])]
      .sort((a, b) => imageRank(a.variant) - imageRank(b.variant))
      .map((image) => image.link);
    return {
      asin: item.asin,
      name: summary?.itemName ?? item.asin,
      brand: summary?.brand ?? null,
      productType: pick(item.productTypes, this.marketplaceId)?.productType ?? null,
      ean,
      images: [...new Set(images)],
    };
  }
}

/** Digits only, 8-14 long, padded to EAN-13; anything else is not searchable. */
export function normalizeEan(value: string): string | null {
  const digits = value.trim();
  if (!/^\d{8,14}$/.test(digits)) {
    return null;
  }
  return digits.length < 13 ? digits.padStart(13, '0') : digits;
}

/** Every barcode an item carries, normalised to EAN-13. */
function barcodesOf(item: AmazonCatalogItem): Set<string> {
  const barcodes = new Set<string>();
  // A barcode is global, so every marketplace's identifier set counts.
  for (const set of item.identifiers ?? []) {
    for (const identifier of set.identifiers) {
      const normalized = BARCODE_IDENTIFIER_TYPES.has(identifier.identifierType)
        ? normalizeEan(identifier.identifier)
        : null;
      if (normalized !== null) {
        barcodes.add(normalized);
      }
    }
  }
  return barcodes;
}

function pick<T extends { readonly marketplaceId: string }>(
  entries: readonly T[] | undefined,
  marketplaceId: string,
): T | undefined {
  return entries?.find((entry) => entry.marketplaceId === marketplaceId) ?? entries?.[0];
}

function imageRank(variant: string): number {
  return variant === 'MAIN' ? 0 : 1;
}
