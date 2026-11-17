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

export interface AmazonListingItem {
  readonly sku: string;
  readonly summaries?: readonly AmazonListingSummary[];
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
