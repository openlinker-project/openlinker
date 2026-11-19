/**
 * AmazonCatalogReader tests (#4181)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager/__tests__
 */
import type { AmazonCatalogItem } from '../../../../domain/types/amazon-catalog.types';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonCatalogReader, normalizeEan } from '../amazon-catalog-reader';

const DE = 'A1PA6795UKMFR9';

const mug: AmazonCatalogItem = {
  asin: 'B0MUG00001',
  summaries: [
    { marketplaceId: 'A13V1IB3VIYZZH', itemName: 'Tasse bleue (FR)' },
    { marketplaceId: DE, itemName: 'Blaue Tasse', brand: 'Acme' },
  ],
  images: [
    {
      marketplaceId: DE,
      images: [
        { variant: 'PT01', link: 'https://m.media-amazon.com/side.jpg' },
        { variant: 'MAIN', link: 'https://m.media-amazon.com/main.jpg' },
      ],
    },
  ],
  identifiers: [{ marketplaceId: DE, identifiers: [{ identifierType: 'EAN', identifier: '5901234123457' }] }],
  productTypes: [{ marketplaceId: DE, productType: 'KITCHEN' }],
};

function setup(): { reader: AmazonCatalogReader; get: jest.Mock } {
  const get = jest.fn().mockResolvedValue({ status: 200, data: { numberOfResults: 1, items: [mug] }, requestId: 'r' });
  return { reader: new AmazonCatalogReader({ get } as unknown as AmazonSpApiClient, DE), get };
}

describe('AmazonCatalogReader', () => {
  it('should search the catalogue by EAN in the primary marketplace', async () => {
    const { reader, get } = setup();

    const entries = await reader.findByEan('5901234123457');

    expect(get).toHaveBeenCalledWith('/catalog/2022-04-01/items', {
      identifiers: ['5901234123457'],
      identifiersType: 'EAN',
      marketplaceIds: [DE],
      includedData: ['summaries', 'images', 'identifiers', 'productTypes'],
      pageSize: 10,
    });
    expect(entries).toEqual([
      {
        asin: 'B0MUG00001',
        name: 'Blaue Tasse',
        brand: 'Acme',
        productType: 'KITCHEN',
        ean: '5901234123457',
        images: ['https://m.media-amazon.com/main.jpg', 'https://m.media-amazon.com/side.jpg'],
      },
    ]);
  });

  it('should not call Amazon for a value that is not a barcode', async () => {
    const { reader, get } = setup();

    await expect(reader.findByEan('abc')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('should read one item by ASIN', async () => {
    const { reader, get } = setup();
    get.mockResolvedValue({ status: 200, data: mug, requestId: 'r' });

    const entry = await reader.getByAsin('B0MUG00001');

    expect(get).toHaveBeenCalledWith('/catalog/2022-04-01/items/B0MUG00001', expect.objectContaining({ marketplaceIds: [DE] }));
    expect(entry.asin).toBe('B0MUG00001');
  });
});

describe('normalizeEan', () => {
  it('should pad a UPC to EAN-13 and refuse anything else', () => {
    expect(normalizeEan('012345678905')).toBe('0012345678905');
    expect(normalizeEan(' 5901234123457 ')).toBe('5901234123457');
    expect(normalizeEan('123')).toBeNull();
    expect(normalizeEan('59012-3412')).toBeNull();
  });
});
