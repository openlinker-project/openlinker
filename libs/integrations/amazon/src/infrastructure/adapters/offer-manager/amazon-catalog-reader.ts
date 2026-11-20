/**
 * Amazon Catalog Reader (#4181)
 *
 * Reads Amazon's product catalogue (Catalog Items API v2022-04-01) for the
 * publish path: a barcode (EAN) is looked up with `searchCatalogItems`
 * (`identifiersType=EAN`), an ASIN with `getCatalogItem`. Each item is reduced
 * to one marketplace's view: its title, brand, product type, EAN and images
 * (`MAIN` first).
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
/** `searchCatalogItems` accepts up to 20 identifiers; one EAN never needs more than a page of 10. */
const SEARCH_PAGE_SIZE = 10;

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
    const response = await this.client.get<AmazonCatalogSearchResults>(CATALOG_PATH, {
      identifiers: [normalized],
      identifiersType: 'EAN',
      marketplaceIds: [this.marketplaceId],
      includedData: [...INCLUDED_DATA],
      pageSize: SEARCH_PAGE_SIZE,
    });
    return (response.data.items ?? []).map((item) => this.toEntry(item));
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

function pick<T extends { readonly marketplaceId: string }>(
  entries: readonly T[] | undefined,
  marketplaceId: string,
): T | undefined {
  return entries?.find((entry) => entry.marketplaceId === marketplaceId) ?? entries?.[0];
}

function imageRank(variant: string): number {
  return variant === 'MAIN' ? 0 : 1;
}
