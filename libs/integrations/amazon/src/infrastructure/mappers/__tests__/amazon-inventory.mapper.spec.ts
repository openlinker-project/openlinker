/**
 * Amazon inventory mapper tests (#4183)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import type { AmazonListingItem } from '../../../domain/types/amazon-listing.types';
import { isAmazonFulfilledOnly, sellerFulfilledQuantity } from '../amazon-inventory.mapper';

const item = (fulfillmentAvailability?: AmazonListingItem['fulfillmentAvailability']): AmazonListingItem => ({
  sku: 'MUG',
  ...(fulfillmentAvailability ? { fulfillmentAvailability } : {}),
});

describe('sellerFulfilledQuantity', () => {
  it('should read the DEFAULT channel quantity', () => {
    expect(sellerFulfilledQuantity(item([{ fulfillmentChannelCode: 'DEFAULT', quantity: 4.9 }]))).toBe(4);
  });

  it('should report zero when the listing has no seller channel', () => {
    expect(sellerFulfilledQuantity(item([{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 9 }]))).toBe(0);
    expect(sellerFulfilledQuantity(item())).toBe(0);
  });

  it('should report an unreadable level as null, never zero', () => {
    expect(sellerFulfilledQuantity(item([{ fulfillmentChannelCode: 'DEFAULT' }]))).toBeNull();
  });

  it('should never report a negative quantity', () => {
    expect(sellerFulfilledQuantity(item([{ fulfillmentChannelCode: 'DEFAULT', quantity: -2 }]))).toBe(0);
  });
});

describe('isAmazonFulfilledOnly', () => {
  it('should be true only when every channel is Amazon\'s', () => {
    expect(isAmazonFulfilledOnly(item([{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 1 }]))).toBe(true);
    expect(
      isAmazonFulfilledOnly(
        item([
          { fulfillmentChannelCode: 'AMAZON_EU', quantity: 1 },
          { fulfillmentChannelCode: 'DEFAULT', quantity: 1 },
        ]),
      ),
    ).toBe(false);
    expect(isAmazonFulfilledOnly(item())).toBe(false);
  });
});
