/**
 * AmazonProductMasterAdapter tests (#4182)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/product-master/__tests__
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../../domain/exceptions/amazon-not-supported.exception';
import type { AmazonListingItem } from '../../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonProductMasterAdapter } from '../amazon-product-master.adapter';

const DE = 'A1PA6795UKMFR9';
const CONFIG = {
  region: 'eu' as const,
  environment: 'production' as const,
  marketplaceIds: [DE],
  sellerId: 'A2SELLER123',
  taxCodeRates: { A_GEN_STANDARD: '19' },
};
const connection = { id: 'conn-amz' } as Connection;

const listing = (sku: string, extra: Partial<AmazonListingItem> = {}): AmazonListingItem => ({
  sku,
  summaries: [{ marketplaceId: DE, asin: `B0${sku}`, productType: 'KITCHEN', status: ['BUYABLE'] }],
  attributes: {
    item_name: [{ value: `Item ${sku}`, marketplace_id: DE }],
    main_product_image_locator: [{ media_location: 'https://m.media-amazon.com/x.jpg', marketplace_id: DE }],
    externally_assigned_product_identifier: [{ type: 'ean', value: '5901234123457', marketplace_id: DE }],
    product_tax_code: [{ value: 'A_GEN_STANDARD', marketplace_id: DE }],
  },
  ...extra,
});
const child = (sku: string): AmazonListingItem =>
  listing(sku, { relationships: [{ marketplaceId: DE, relationships: [{ type: 'VARIATION', parentSkus: ['MUG'] }] }] });

function setup(skuByInternalId: Record<string, string> = {}): {
  adapter: AmazonProductMasterAdapter;
  get: jest.Mock;
  identifierMapping: jest.Mocked<IdentifierMappingPort>;
} {
  const get = jest.fn();
  const identifierMapping = {
    getExternalIds: jest.fn((_type: string, id: string) =>
      Promise.resolve(skuByInternalId[id] ? [{ externalId: skuByInternalId[id], connectionId: 'conn-amz' }] : []),
    ),
    getOrCreateInternalId: jest.fn((_type: string, sku: string) => Promise.resolve(`ol_product_${sku}`)),
    batchGetOrCreateInternalIds: jest.fn((requests: Array<{ externalId: string }>) =>
      Promise.resolve(new Map(requests.map((r) => [`${r.externalId}:conn-amz`, `ol_variant_${r.externalId}`]))),
    ),
  } as unknown as jest.Mocked<IdentifierMappingPort>;
  const adapter = new AmazonProductMasterAdapter(
    connection,
    { get } as unknown as AmazonSpApiClient,
    CONFIG,
    identifierMapping,
    new InMemoryCacheAdapter(),
  );
  return { adapter, get, identifierMapping };
}

const ok = (data: unknown) => ({ status: 200, requestId: 'r', data });

describe('AmazonProductMasterAdapter', () => {
  it('should require the merchant token', () => {
    expect(
      () =>
        new AmazonProductMasterAdapter(
          connection,
          {} as AmazonSpApiClient,
          { ...CONFIG, sellerId: undefined },
          {} as IdentifierMappingPort,
        ),
    ).toThrow(AmazonConfigException);
  });

  it('should enumerate products, skipping variation children, over pages', async () => {
    const { adapter, get } = setup();
    get
      .mockResolvedValueOnce(ok({ numberOfResults: 3, items: [listing('A'), child('MUG-RED'), listing('MUG')], pagination: { nextToken: 't1' } }))
      .mockResolvedValueOnce(ok({ numberOfResults: 1, items: [listing('Z')], pagination: {} }));

    await expect(adapter.listExternalIds({ offset: 0, limit: 10 })).resolves.toEqual(['A', 'MUG', 'Z']);
  });

  it('should serve a later window from the checkpoint', async () => {
    const { adapter, get } = setup();
    get
      .mockResolvedValueOnce(ok({ numberOfResults: 2, items: [listing('A'), listing('B')], pagination: { nextToken: 't1' } }))
      .mockResolvedValueOnce(ok({ numberOfResults: 2, items: [listing('C'), listing('D')], pagination: {} }));
    await expect(adapter.listExternalIds({ offset: 0, limit: 2 })).resolves.toEqual(['A', 'B']);

    get.mockResolvedValueOnce(ok({ numberOfResults: 2, items: [listing('C'), listing('D')], pagination: {} }));
    await expect(adapter.listExternalIds({ offset: 2, limit: 2 })).resolves.toEqual(['C', 'D']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('should report a changed child as its parent in the modified-since window', async () => {
    const { adapter, get } = setup();
    get.mockResolvedValueOnce(ok({ numberOfResults: 2, items: [child('MUG-RED'), child('MUG-BLUE')], pagination: {} }));

    await expect(
      adapter.listExternalIdsModifiedSince({ since: new Date('2026-11-01T12:00:00Z'), offset: 0, limit: 10 }),
    ).resolves.toEqual(['MUG']);
    expect((get.mock.calls as unknown[][])[0][1]).toMatchObject({ lastUpdatedAfter: '2026-11-01T11:59:00Z' });
  });

  it('should read a product and its variation children as variants', async () => {
    const { adapter, get } = setup({ ol_product_MUG: 'MUG' });
    const parent = listing('MUG', {
      attributes: { item_name: [{ value: 'Mug', marketplace_id: DE }], variation_theme: [{ name: 'COLOR_NAME' }] },
      relationships: [{ marketplaceId: DE, relationships: [{ type: 'VARIATION', childSkus: ['MUG-RED'] }] }],
    });
    get
      .mockResolvedValueOnce(ok(parent))
      .mockResolvedValueOnce(
        ok({ numberOfResults: 1, items: [listing('MUG-RED', { attributes: { color: [{ value: 'Rot', marketplace_id: DE }] } })] }),
      );

    const variants = await adapter.getProductVariants('ol_product_MUG');

    expect(variants).toEqual([
      expect.objectContaining({ id: 'ol_variant_MUG-RED', productId: 'ol_product_MUG', sku: 'MUG-RED', attributes: { color: 'Rot' } }),
    ]);
  });

  it('should treat a standalone listing as its own single variant', async () => {
    const { adapter, get } = setup({ ol_product_A: 'A' });
    get.mockResolvedValueOnce(ok(listing('A')));

    const variants = await adapter.getProductVariants('ol_product_A');

    expect(variants).toEqual([expect.objectContaining({ id: 'ol_variant_A', sku: 'A', ean: '5901234123457' })]);
  });

  it('should raise the deletion signal for a listing Amazon no longer has', async () => {
    const { adapter, get } = setup({ ol_product_GONE: 'GONE' });
    get.mockRejectedValue(new AmazonApiError(404, 'NOT_FOUND', 'gone', 'r'));

    await expect(adapter.getProduct('ol_product_GONE')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should resolve the tax rate only through the connection map', async () => {
    const { adapter, get } = setup({ ol_product_A: 'A' });
    get.mockResolvedValueOnce(ok(listing('A')));
    await expect(adapter.readProductTaxRate({ productId: 'ol_product_A' })).resolves.toEqual({
      kind: 'resolved',
      code: '19',
      countryIso2: 'DE',
    });

    const unmapped = setup({ ol_product_B: 'B' });
    unmapped.get.mockResolvedValueOnce(
      ok(listing('B', { attributes: { product_tax_code: [{ value: 'A_BOOKS_GEN', marketplace_id: DE }] } })),
    );
    await expect(unmapped.adapter.readProductTaxRate({ productId: 'ol_product_B' })).resolves.toMatchObject({
      kind: 'unknown',
      reason: 'not-configured',
    });
  });

  it('should refuse writes', async () => {
    const { adapter } = setup();
    await expect(adapter.updateProduct('x', {} as never)).rejects.toBeInstanceOf(AmazonNotSupportedException);
    await expect(adapter.getProducts({ query: 'mug' })).rejects.toBeInstanceOf(AmazonNotSupportedException);
  });
});
