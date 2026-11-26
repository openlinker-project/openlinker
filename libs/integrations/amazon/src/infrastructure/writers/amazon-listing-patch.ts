/**
 * Amazon Listing Patch (#4180, shared since #4183)
 *
 * `patchListingsItem` for one of the seller's listings, used by the offer
 * manager (stock, price) and the inventory master (stock corrections). A patch
 * must name the listing's product type, so the caller passes the listing it
 * has just read. A patch Amazon answers `INVALID` is raised as an
 * `AmazonApiError` carrying Amazon's first issue; `ACCEPTED` means Amazon
 * queued it, applied a few minutes later.
 *
 * @module libs/integrations/amazon/src/infrastructure/writers
 */
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonNotSupportedException } from '../../domain/exceptions/amazon-not-supported.exception';
import {
  AMAZON_SELLER_FULFILLMENT_CHANNEL,
  type AmazonListingItem,
  type AmazonListingSubmissionResponse,
} from '../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../http/amazon-spapi-client';

export const AMAZON_LISTINGS_PATH = '/listings/2021-08-01/items';

export async function patchAmazonListing(
  client: AmazonSpApiClient,
  sellerId: string,
  item: AmazonListingItem,
  marketplaceIds: readonly string[],
  patches: readonly Record<string, unknown>[],
): Promise<void> {
  const productType = item.summaries?.[0]?.productType;
  if (productType === undefined) {
    throw new AmazonNotSupportedException(`listing ${item.sku} reports no product type to patch`);
  }
  const response = await client.patch<AmazonListingSubmissionResponse>(
    `${AMAZON_LISTINGS_PATH}/${encodeURIComponent(sellerId)}/${encodeURIComponent(item.sku)}`,
    { productType, patches },
    { marketplaceIds },
  );
  if (response.data.status === 'INVALID') {
    const first = response.data.issues?.find((issue) => issue.severity === 'ERROR') ?? response.data.issues?.[0];
    throw new AmazonApiError(
      400,
      first?.code ?? 'INVALID',
      first?.message ?? 'Amazon refused the listing update',
      response.requestId,
    );
  }
}

/** The patch replacing the seller-fulfilled quantity (`fulfillment_availability`, channel `DEFAULT`). */
export function sellerQuantityPatch(quantity: number): Record<string, unknown> {
  return {
    op: 'replace',
    path: '/attributes/fulfillment_availability',
    value: [{ fulfillment_channel_code: AMAZON_SELLER_FULFILLMENT_CHANNEL, quantity: Math.max(0, Math.floor(quantity)) }],
  };
}
