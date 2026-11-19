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
  return { adapter: new AmazonOfferManagerAdapter('conn-amz', client, config, jest.fn()), get, patch };
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
      includedData: ['summaries', 'fulfillmentAvailability'],
      sortBy: 'sku',
      sortOrder: 'ASC',
      pageSize: 20,
    });
    expect(result.items[0]).toMatchObject({
      offerId: 'MUG-BLUE',
      sku: 'MUG-BLUE',
      externalRef: 'B0ABCDEFGH',
      raw: { fulfilledByAmazon: false },
    });
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

  it('should skip, not fail, writing stock to a listing Amazon fulfils', async () => {
    const { adapter, get, patch } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: fbmListing({ fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 40 }] }),
    });
    await expect(adapter.updateOfferQuantity({ offerId: 'MUG-BLUE', quantity: 3 })).resolves.toBeUndefined();
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

  it('should read a listing Amazon has not processed yet as activating', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: fbmListing({ summaries: [], issues: [] }) });

    await expect(adapter.getOfferStatus('MUG-NEW')).resolves.toMatchObject({
      publicationStatus: 'activating',
      validationErrors: [],
    });
  });

  it('should read an unprocessed listing with an ERROR issue as inactive with that error', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: fbmListing({
        summaries: [],
        issues: [{ code: '90220', message: 'brand is required', severity: 'ERROR', attributeNames: ['brand'] }],
      }),
    });

    await expect(adapter.getOfferStatus('MUG-NEW')).resolves.toMatchObject({
      publicationStatus: 'inactive',
      validationErrors: [{ code: '90220', message: 'brand is required', field: 'brand' }],
    });
  });

  it('should report a listing Amazon no longer has as ended', async () => {
    const { adapter, get } = setup();
    get.mockRejectedValue(new AmazonApiError(404, 'NOT_FOUND', 'Requested item not found', 'r'));

    await expect(adapter.getOfferStatus('MUG-GONE')).resolves.toEqual({ publicationStatus: 'ended', validationErrors: [] });
  });

  it('should let any other read error through', async () => {
    const { adapter, get } = setup();
    get.mockRejectedValue(new AmazonApiError(500, 'InternalFailure', 'boom', 'r'));

    await expect(adapter.getOfferStatus('MUG-BLUE')).rejects.toBeInstanceOf(AmazonApiError);
  });
});

const catalogHit = {
  asin: 'B0MUG00001',
  summaries: [{ marketplaceId: 'A1PA6795UKMFR9', itemName: 'Blaue Tasse', brand: 'Acme' }],
  productTypes: [{ marketplaceId: 'A1PA6795UKMFR9', productType: 'KITCHEN' }],
};

function catalogSetup(items: unknown[]): { adapter: AmazonOfferManagerAdapter; get: jest.Mock } {
  const { adapter, get } = setup();
  get.mockResolvedValue({ status: 200, data: { numberOfResults: items.length, items }, requestId: 'r' });
  return { adapter, get };
}

describe('AmazonOfferManagerAdapter.findProductsByBarcode', () => {
  it('should report one catalogue item as a unique match with its ASIN', async () => {
    const { adapter } = catalogSetup([catalogHit]);

    const result = await adapter.findProductsByBarcode({ barcode: '5901234123457' });

    expect(result).toMatchObject({
      kind: 'unique',
      product: { id: 'B0MUG00001', name: 'Blaue Tasse', parameters: [{ parameterId: 'brand', valueStrings: ['Acme'] }] },
    });
  });

  it('should report no match and an ambiguity', async () => {
    await expect(catalogSetup([]).adapter.findProductsByBarcode({ barcode: '5901234123457' })).resolves.toEqual({
      kind: 'no_match',
    });
    const ambiguous = await catalogSetup([catalogHit, { ...catalogHit, asin: 'B0MUG00002' }]).adapter.findProductsByBarcode({
      barcode: '5901234123457',
    });
    expect(ambiguous).toMatchObject({ kind: 'ambiguous', products: [{ id: 'B0MUG00001' }, { id: 'B0MUG00002' }] });
  });

  it('should translate an unknown ASIN into the core not-found exception', async () => {
    const { adapter, get } = setup();
    get.mockRejectedValue(new AmazonApiError(404, 'NOT_FOUND', 'no item', 'r'));

    await expect(adapter.getProduct({ productId: 'B0NOPE' })).rejects.toThrow('Catalog product not found: B0NOPE');
  });
});

describe('AmazonOfferManagerAdapter.resolveCategoriesForBatchByEan', () => {
  it('should resolve each variant without failing the batch', async () => {
    const { adapter, get } = setup();
    get
      .mockResolvedValueOnce({ status: 200, data: { numberOfResults: 1, items: [catalogHit] }, requestId: 'r' })
      .mockRejectedValueOnce(new AmazonApiError(500, 'InternalFailure', 'boom', 'r'))
      .mockResolvedValueOnce({
        status: 200,
        data: { numberOfResults: 2, items: [catalogHit, { ...catalogHit, asin: 'B0MUG00002' }] },
        requestId: 'r',
      });

    const result = await adapter.resolveCategoriesForBatchByEan({
      items: [
        { variantId: 'v1', ean: '5901234123457' },
        { variantId: 'v2', ean: null },
        { variantId: 'v3', ean: '5901234123458' },
        { variantId: 'v4', ean: '5901234123459' },
      ],
    });

    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'KITCHEN',
      productCardId: 'B0MUG00001',
      method: 'auto_detect',
    });
    expect(result.get('v2')).toEqual({ kind: 'no-ean' });
    expect(result.get('v3')).toEqual({ kind: 'no-match' });
    expect(result.get('v4')).toMatchObject({ kind: 'multi-match', candidates: [{ productCardId: 'B0MUG00001' }, {}] });
  });
});

describe('AmazonOfferManagerAdapter.createOffer', () => {
  const cmd = {
    internalVariantId: 'ol_variant_abc',
    connectionId: 'conn-amz',
    price: { amount: 19.99, currency: 'EUR' },
    stock: 3,
    publishImmediately: true,
    productCardId: 'B0MUG00001',
    overrides: { categoryId: 'KITCHEN' },
  };

  function createSetup(): { adapter: AmazonOfferManagerAdapter; get: jest.Mock; put: jest.Mock } {
    const get = jest.fn().mockRejectedValue(new AmazonApiError(404, 'NOT_FOUND', 'no listing', 'r'));
    const put = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { sku: 'OL-abc', status: 'ACCEPTED', submissionId: 's1' }, requestId: 'r' });
    const client = { get, put } as unknown as AmazonSpApiClient;
    return { adapter: new AmazonOfferManagerAdapter('conn-amz', client, CONFIG, jest.fn()), get, put };
  }

  it('should list an offer on the matched ASIN and report it validating', async () => {
    const { adapter, put } = createSetup();

    const result = await adapter.createOffer(cmd);

    expect(put).toHaveBeenCalledWith(
      '/listings/2021-08-01/items/A2SELLER123/OL-abc',
      expect.objectContaining({ productType: 'KITCHEN', requirements: 'LISTING_OFFER_ONLY' }),
      { marketplaceIds: ['A1PA6795UKMFR9', 'A13V1IB3VIYZZH'] },
    );
    expect(result).toEqual({ externalOfferId: 'OL-abc', status: 'validating' });
  });

  it('should report a listing Amazon refuses as a draft with its issues', async () => {
    const { adapter, put } = createSetup();
    put.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: {
        sku: 'OL-abc',
        status: 'INVALID',
        submissionId: 's1',
        issues: [{ code: '90220', message: 'condition_type is required', severity: 'ERROR', attributeNames: ['condition_type'] }],
      },
    });

    await expect(adapter.createOffer(cmd)).resolves.toEqual({
      externalOfferId: 'OL-abc',
      status: 'draft',
      validationErrors: [{ code: '90220', message: 'condition_type is required', field: 'condition_type' }],
    });
  });

  it('should not overwrite a listing that already exists under the SKU', async () => {
    const { adapter, get, put } = createSetup();
    get.mockResolvedValue({ status: 200, data: fbmListing({ sku: 'OL-abc' }), requestId: 'r' });

    await expect(adapter.createOffer(cmd)).resolves.toEqual({
      externalOfferId: 'OL-abc',
      status: 'active',
      alreadyExisted: true,
    });
    expect(put).not.toHaveBeenCalled();
  });

  const newItem = {
    ...cmd,
    productCardId: null,
    variantBarcode: '5901234123457',
    overrides: { categoryId: 'KITCHEN', title: 'Blue mug', imageUrls: ['https://shop.example/1.jpg'] },
    parameters: [{ id: 'color', values: ['Blue'], section: 'product' as const }],
    sourceAttributes: [{ name: 'Manufacturer', value: 'Acme' }],
  };

  it('should create a new catalogue item when no ASIN matches', async () => {
    const { adapter, put } = createSetup();

    await expect(adapter.createOffer(newItem)).resolves.toEqual({ externalOfferId: 'OL-abc', status: 'validating' });
    const body = (put.mock.calls as unknown[][])[0][1] as { requirements: string; productType: string; attributes: Record<string, unknown> };
    expect(body.requirements).toBe('LISTING');
    expect(body.productType).toBe('KITCHEN');
    expect(body.attributes).toMatchObject({
      brand: [{ value: 'Acme', language_tag: 'de_DE', marketplace_id: 'A1PA6795UKMFR9' }, {}],
      externally_assigned_product_identifier: [{ type: 'ean', value: '5901234123457' }, {}],
      color: [{ value: 'Blue' }],
    });
  });

  it('should refuse a new item without a barcode, a product type or a brand', async () => {
    const { adapter, put } = createSetup();

    await expect(adapter.createOffer({ ...newItem, variantBarcode: null })).rejects.toThrow(/GTIN exemption/);
    await expect(adapter.createOffer({ ...newItem, overrides: { title: 'Blue mug' } })).rejects.toThrow(/product type/);
    await expect(adapter.createOffer({ ...newItem, sourceAttributes: [] })).rejects.toThrow(/brand/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('AmazonOfferManagerAdapter taxonomy', () => {
  it('should name one tree per marketplace and environment', () => {
    expect(setup().adapter.getTaxonomyIdentity()).toBe('amazon:A1PA6795UKMFR9');
    expect(setup({ ...CONFIG, environment: 'sandbox' } as unknown as typeof CONFIG).adapter.getTaxonomyIdentity()).toBe(
      'amazon:sandbox:A1PA6795UKMFR9',
    );
  });

  it('should list product types as a flat list of leaves', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { productTypes: [{ name: 'KITCHEN', displayName: 'Kitchen' }] } });

    await expect(adapter.fetchCategories()).resolves.toEqual([{ id: 'KITCHEN', name: 'Kitchen', parentId: null, leaf: true }]);
    await expect(adapter.fetchCategories('KITCHEN')).resolves.toEqual([]);
  });
});
