/**
 * Amazon Listings Items Wire Types (#4180)
 *
 * The subset of Listings Items API v2021-08-01 the offer manager reads and
 * writes, from Amazon's published model
 * (`listings-items-api-model/listingsItems_2021-08-01.json`).
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export interface AmazonListingSummary {
  readonly marketplaceId: string;
  readonly asin?: string;
  readonly productType: string;
  /** `BUYABLE` and/or `DISCOVERABLE`. */
  readonly status: readonly string[];
  readonly itemName?: string;
  readonly fnSku?: string;
  /** The listing's main image as Amazon hosts it, present whenever it has one. */
  readonly mainImage?: { readonly link: string; readonly height?: number; readonly width?: number };
}

export interface AmazonListingIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly attributeNames?: readonly string[];
}

export interface AmazonListingOffer {
  readonly marketplaceId: string;
  readonly offerType: 'B2C' | 'B2B';
  readonly price: { readonly amount: string; readonly currencyCode: string };
}

export interface AmazonFulfillmentAvailability {
  /** `DEFAULT` for seller-fulfilled stock; anything else (e.g. `AMAZON_EU`) is FBA. */
  readonly fulfillmentChannelCode: string;
  readonly quantity?: number;
}

/** One attribute value as Listings Items reports it (`attributes.<name>[]`). */
export type AmazonAttributeValue = Readonly<Record<string, unknown>>;

/** A listing's variation links (`relationships[].relationships[]`, type `VARIATION`). */
export interface AmazonListingRelationship {
  readonly type: string;
  readonly parentSkus?: readonly string[];
  readonly childSkus?: readonly string[];
  readonly variationTheme?: { readonly attributes?: readonly string[]; readonly theme?: string };
}

export interface AmazonListingRelationshipSet {
  readonly marketplaceId: string;
  readonly relationships: readonly AmazonListingRelationship[];
}

export interface AmazonListingItem {
  readonly sku: string;
  readonly summaries?: readonly AmazonListingSummary[];
  readonly attributes?: Readonly<Record<string, readonly AmazonAttributeValue[] | undefined>>;
  readonly relationships?: readonly AmazonListingRelationshipSet[];
  readonly issues?: readonly AmazonListingIssue[];
  readonly offers?: readonly AmazonListingOffer[];
  readonly fulfillmentAvailability?: readonly AmazonFulfillmentAvailability[];
}

export interface AmazonListingSearchResults {
  readonly numberOfResults: number;
  readonly items: readonly AmazonListingItem[];
  readonly pagination?: { readonly nextToken?: string };
}

export interface AmazonListingSubmissionResponse {
  readonly sku: string;
  readonly status: 'ACCEPTED' | 'INVALID' | 'VALID';
  readonly submissionId: string;
  readonly issues?: readonly AmazonListingIssue[];
}

/** The fulfilment channel of seller-fulfilled stock. */
export const AMAZON_SELLER_FULFILLMENT_CHANNEL = 'DEFAULT';

/**
 * A seller-fulfilled stock patch Amazon accepted but may not have applied yet
 * (#4183 review). Amazon applies an accepted patch minutes later, so a listing
 * read inside that window still shows `readQuantity`; the next adjustment
 * starts from `writtenQuantity` instead, or a back-to-back decrement is lost.
 */
export interface AmazonPendingStockWrite {
  /** The seller-fulfilled quantity Amazon reported before the first patch of the chain. */
  readonly readQuantity: number;
  /** The quantities written since, oldest first; the last one is the newest. */
  readonly writtenQuantities: readonly number[];
}
