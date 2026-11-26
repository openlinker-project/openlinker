/**
 * Amazon Inventory Mapper (#4183)
 *
 * Reads the seller-fulfilled (FBM) quantity off a listing. Amazon reports a
 * listing's stock per fulfilment channel: `DEFAULT` is the seller's own stock,
 * any other code (`AMAZON_EU`, `AMAZON_NA`) is FBA, read separately.
 *
 *   - a `DEFAULT` entry with a number: that number (floored, never negative).
 *   - a `DEFAULT` entry without a readable number: `null`, an unreadable level
 *     the caller raises as an error, never 0.
 *   - no `DEFAULT` entry: 0. The listing has no seller-fulfilled offer (FBA
 *     only, or no offer yet), so there is nothing the seller can ship from
 *     their own stock.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import {
  AMAZON_SELLER_FULFILLMENT_CHANNEL,
  type AmazonListingItem,
} from '../../domain/types/amazon-listing.types';

export function sellerFulfilledQuantity(item: AmazonListingItem): number | null {
  const entry = (item.fulfillmentAvailability ?? []).find(
    (channel) => channel.fulfillmentChannelCode === AMAZON_SELLER_FULFILLMENT_CHANNEL,
  );
  if (entry === undefined) {
    return 0;
  }
  const quantity = entry.quantity;
  return typeof quantity === 'number' && Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : null;
}

/** Whether Amazon fulfils this listing and the seller has no channel of their own on it. */
export function isAmazonFulfilledOnly(item: AmazonListingItem): boolean {
  const channels = item.fulfillmentAvailability ?? [];
  return (
    channels.length > 0 &&
    channels.every((channel) => channel.fulfillmentChannelCode !== AMAZON_SELLER_FULFILLMENT_CHANNEL)
  );
}
