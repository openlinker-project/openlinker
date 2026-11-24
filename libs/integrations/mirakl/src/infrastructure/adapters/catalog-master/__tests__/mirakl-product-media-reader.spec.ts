/**
 * Mirakl Product Media Reader: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import type { IMiraklHttpClient } from '../../../http/mirakl-http-client.interface';
import type { MiraklRequestOptions } from '../../../http/mirakl-http-client.types';
import {
  MIRAKL_P11_MAX_PRODUCT_IDS,
  MiraklProductMediaReader,
} from '../mirakl-product-media-reader';

function fakeP11(): { reader: MiraklProductMediaReader; get: jest.Mock } {
  const get = jest.fn((_path: string, options?: MiraklRequestOptions) => {
    const ids = String(options?.queryParams?.product_ids ?? '').split(',');
    return Promise.resolve({
      status: 200,
      data: {
        products: ids.map((id) => ({
          product_sku: id,
          product_media: id.endsWith('0') ? null : { media_url: `https://media.example/${id}` },
        })),
      },
    });
  });
  const reader = new MiraklProductMediaReader({ get } as unknown as IMiraklHttpClient);
  return { reader, get };
}

describe('MiraklProductMediaReader', () => {
  it('should split the skus into calls of at most the P11 limit', async () => {
    const { reader, get } = fakeP11();
    const skus = Array.from({ length: MIRAKL_P11_MAX_PRODUCT_IDS + 1 }, (_, i) => `S${i + 1}`);

    const images = await reader.imagesFor(skus);

    expect(get).toHaveBeenCalledTimes(2);
    expect(images.get('S1')).toEqual(['https://media.example/S1']);
    expect(images.get('S10')).toEqual([]);
    expect(images.size).toBe(skus.length);
  });

  it('should not ask P11 again for a card it already read', async () => {
    const { reader, get } = fakeP11();

    await reader.imagesFor(['S1', 'S2']);
    await reader.imagesFor(['S2', 'S1']);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should answer no images for a sku P11 does not return', async () => {
    const get = jest.fn(() => Promise.resolve({ status: 200, data: { products: [] } }));
    const reader = new MiraklProductMediaReader({ get } as unknown as IMiraklHttpClient);

    expect((await reader.imagesFor(['GONE'])).get('GONE')).toEqual([]);
  });

  it('should make no call for an empty list', async () => {
    const { reader, get } = fakeP11();

    expect((await reader.imagesFor([])).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});
