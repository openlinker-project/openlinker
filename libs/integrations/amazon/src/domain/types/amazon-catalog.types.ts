/**
 * Amazon Catalog Items Types (#4181)
 *
 * The subset of Catalog Items API v2022-04-01 (`searchCatalogItems`,
 * `getCatalogItem`) the publish path reads: an item's ASIN, its title, brand,
 * images, identifiers and product type per marketplace. Every field Amazon
 * may leave out is optional.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export interface AmazonCatalogItemSummary {
  readonly marketplaceId: string;
  readonly itemName?: string;
  readonly brand?: string;
}

export interface AmazonCatalogImage {
  readonly variant: string;
  readonly link: string;
  readonly height?: number;
  readonly width?: number;
}

export interface AmazonCatalogImageSet {
  readonly marketplaceId: string;
  readonly images: readonly AmazonCatalogImage[];
}

export interface AmazonCatalogIdentifier {
  readonly identifierType: string;
  readonly identifier: string;
}

export interface AmazonCatalogIdentifierSet {
  readonly marketplaceId: string;
  readonly identifiers: readonly AmazonCatalogIdentifier[];
}

export interface AmazonCatalogProductType {
  readonly marketplaceId: string;
  readonly productType: string;
}

export interface AmazonCatalogItem {
  readonly asin: string;
  readonly summaries?: readonly AmazonCatalogItemSummary[];
  readonly images?: readonly AmazonCatalogImageSet[];
  readonly identifiers?: readonly AmazonCatalogIdentifierSet[];
  readonly productTypes?: readonly AmazonCatalogProductType[];
}

export interface AmazonCatalogSearchResults {
  readonly numberOfResults: number;
  readonly items: readonly AmazonCatalogItem[];
  readonly pagination?: { readonly nextToken?: string; readonly previousToken?: string };
}

/** What the publish path needs from one catalog item, in one marketplace. */
export interface AmazonCatalogEntry {
  readonly asin: string;
  readonly name: string;
  readonly brand: string | null;
  readonly productType: string | null;
  readonly ean: string | null;
  readonly images: readonly string[];
}
