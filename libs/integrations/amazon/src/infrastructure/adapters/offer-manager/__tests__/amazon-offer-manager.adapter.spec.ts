/**
 * AmazonOfferManagerAdapter tests (#4180)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager/__tests__
 */
import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../../domain/exceptions/amazon-not-supported.exception';
import type { AmazonListingItem } from '../../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonOfferManagerAdapter } from '../amazon-offer-manager.adapter';

const CONFIG = {
  region: 'eu' as const,
  environment: 'production' as const,
  marketplaceIds: ['A1PA6795UKMFR9', 'A13V1IB3VIYZZH', 'A1C3SOZRARQ6R3'],
  sellerId: 'A2SELLER123',
};

const fbmListing = (overrides: Partial<AmazonListingItem> = {}): AmazonListingItem => ({
  sku: 'MUG-BLUE',
  summaries: [
    { marketplaceId: 'A1PA6795UKMFR9', asin: 'B0ABCDEFGH', productType: 'KITCHEN', status: ['BUYABLE', 'DISCOVERABLE'] },
  ],
  fulfillmentAvailability: [{ fulfillmentChannelCode: 'DEFAULT', quantity: 7 }],
  ...overrides,
});

function setup(config = CONFIG): { adapter: AmazonOfferManagerAdapter; get: jest.Mock; patch: jest.Mock } {
  const get = jest.fn().mockResolvedValue({ status: 200, data: fbmListing(), requestId: 'r' });
  const patch = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { sku: 'MUG-BLUE', status: 'ACCEPTED', submissionId: 's1' }, requestId: 'r' });
  const client = { get, patch } as unknown as AmazonSpApiClient;
  return { adapter: new AmazonOfferManagerAdapter('conn-amz', client, config), get, patch };
}

describe('AmazonOfferManagerAdapter.listOffers', () => {
  it('should list the seller listings by SKU with the ASIN as external reference', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: { numberOfResults: 1, items: [fbmListing()], pagination: { nextToken: 'next' } },
    });

    const result = await adapter.listOffers({ cursor: null, limit: 100 });

    expect(get).toHaveBeenCalledWith('/listings/2021-08-01/items/A2SELLER123', {
      marketplaceIds: ['A1PA6795UKMFR9'],
      includedData: ['summaries'],
      sortBy: 'sku',
      sortOrder: 'ASC',
      pageSize: 20,
    });
    expect(result.items[0]).toMatchObject({ offerId: 'MUG-BLUE', sku: 'MUG-BLUE', externalRef: 'B0ABCDEFGH' });
    expect(result.nextCursor).toBe('next');
  });

  it('should pass the page token on', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { numberOfResults: 0, items: [] } });
    const result = await adapter.listOffers({ cursor: 'tok', limit: 5 });
    expect((get.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ pageToken: 'tok', pageSize: 5 });
    expect(result.nextCursor).toBeNull();
  });

  it('should refuse without a merchant token', async () => {
    const { adapter } = setup({ ...CONFIG, sellerId: undefined } as unknown as typeof CONFIG);
    await expect(adapter.listOffers({ cursor: null, limit: 20 })).rejects.toBeInstanceOf(AmazonConfigException);
  });
});

describe('AmazonOfferManagerAdapter.updateOfferQuantity', () => {
  it('should replace the seller-fulfilled quantity with the listing product type', async () => {
    const { adapter, patch } = setup();

    await adapter.updateOfferQuantity({ offerId: 'MUG-BLUE', quantity: 3 });

    expect(patch).toHaveBeenCalledWith(
      '/listings/2021-08-01/items/A2SELLER123/MUG-BLUE',
      {
        productType: 'KITCHEN',
        patches: [
          {
            op: 'replace',
            path: '/attributes/fulfillment_availability',
            value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 3 }],
          },
        ],
      },
      { marketplaceIds: CONFIG.marketplaceIds },
    );
  });

  it('should write zero to pause a listing', async () => {
    const { adapter, patch } = setup();
    await adapter.updateOfferQuantity({ offerId: 'MUG-BLUE', quantity: 0 });
    const body = (patch.mock.calls[0] as [string, { patches: { value: { quantity: number }[] }[] }])[1];
    expect(body.patches[0].value[0].quantity).toBe(0);
  });

  it('should never write stock to a listing Amazon fulfils', async () => {
    const { adapter, get, patch } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: fbmListing({ fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 40 }] }),
    });
    await expect(adapter.updateOfferQuantity({ offerId: 'MUG-BLUE', quantity: 3 })).rejects.toBeInstanceOf(
      AmazonNotSupportedException,
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('should reject a patch Amazon answers INVALID with its issue', async () => {
    const { adapter, patch } = setup();
    patch.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: {
        sku: 'MUG-BLUE',
        status: 'INVALID',
        submissionId: 's',
        issues: [{ code: '90220', message: 'quantity is required', severity: 'ERROR' }],
      },
    });
    const error = await adapter.updateOfferQuantity({ offerId: 'MUG-BLUE', quantity: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmazonApiError);
    expect(error).toMatchObject({ errorCode: '90220' });
  });
});

describe('AmazonOfferManagerAdapter.updateOfferFields', () => {
  it('should write a EUR price to the EUR marketplaces only', async () => {
    const { adapter, patch } = setup();

    await adapter.updateOfferFields({ externalOfferId: 'MUG-BLUE', fields: { price: { amount: '19.99', currency: 'EUR' } } });

    const [, body, query] = patch.mock.calls[0] as [string, { patches: { value: unknown }[] }, { marketplaceIds: string[] }];
    expect(query.marketplaceIds).toEqual(['A1PA6795UKMFR9', 'A13V1IB3VIYZZH']);
    expect(body.patches[0]).toEqual({
      op: 'replace',
      path: '/attributes/purchasable_offer',
      value: [
        { marketplace_id: 'A1PA6795UKMFR9', currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] },
        { marketplace_id: 'A13V1IB3VIYZZH', currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] },
      ],
    });
  });

  it('should refuse a price in a currency no configured marketplace sells in', async () => {
    const { adapter, patch } = setup();
    await expect(
      adapter.updateOfferFields({ externalOfferId: 'MUG-BLUE', fields: { price: { amount: '10', currency: 'USD' } } }),
    ).rejects.toBeInstanceOf(AmazonNotSupportedException);
    expect(patch).not.toHaveBeenCalled();
  });

  it('should refuse a title or description rather than ignore it', async () => {
    const { adapter } = setup();
    await expect(
      adapter.updateOfferFields({ externalOfferId: 'MUG-BLUE', fields: { title: 'New title' } }),
    ).rejects.toThrow(/title/);
  });
});

describe('AmazonOfferManagerAdapter.getOfferStatus', () => {
  it('should read a buyable listing as active with its price and quantity', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: fbmListing({
        offers: [{ marketplaceId: 'A1PA6795UKMFR9', offerType: 'B2C', price: { amount: '19.99', currencyCode: 'EUR' } }],
        issues: [
          { code: '18027', message: 'Missing image', severity: 'ERROR', attributeNames: ['main_product_image_locator'] },
          { code: '1', message: 'hint', severity: 'WARNING' },
        ],
      }),
    });

    const status = await adapter.getOfferStatus('MUG-BLUE');

    expect(status).toEqual({
      publicationStatus: 'active',
      validationErrors: [{ code: '18027', message: 'Missing image', field: 'main_product_image_locator' }],
      commercial: { price: { amount: '19.99', currency: 'EUR' }, availableQuantity: 7 },
    });
    expect((get.mock.calls[0] as [string, { includedData: string[] }])[1].includedData).toContain('issues');
  });

  it('should read a listing that is not buyable as inactive', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: fbmListing({ summaries: [{ marketplaceId: 'A1PA6795UKMFR9', productType: 'KITCHEN', status: ['DISCOVERABLE'] }] }),
    });
    await expect(adapter.getOfferStatus('MUG-BLUE')).resolves.toMatchObject({ publicationStatus: 'inactive' });
  });
});
