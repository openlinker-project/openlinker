import type { Connection } from '@openlinker/core/identifier-mapping';
import { isShopAttributeReader } from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperAttribute } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT, envelope } from '../../../__tests__/shoper-test-data';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

function setup(get: jest.Mock): ShoperProductPublisherAdapter {
  return new ShoperProductPublisherAdapter(
    { get, post: jest.fn(), put: jest.fn(), delete: jest.fn() } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve(MAP_CONTEXT) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
}

/** Serves `/attributes` in pages of 50, the way the shop serves a collection. */
function serving(rows: readonly ShoperAttribute[]): jest.Mock {
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  return jest.fn().mockImplementation((_path: string, query?: { page?: number }) => {
    const page = query?.page ?? 1;
    return Promise.resolve({
      status: 200,
      data: envelope(rows.slice((page - 1) * 50, page * 50), { count: rows.length, pages, page }),
    });
  });
}

const MATERIAL: ShoperAttribute = {
  attribute_id: '12',
  attribute_group_id: '3',
  name: 'Materiał',
  type: '2',
  options: [
    { option_id: '41', value: 'Wełna', order: '2' },
    { option_id: '40', value: 'Bawełna', order: '1' },
  ],
};

describe('ShoperProductPublisherAdapter attribute read', () => {
  it('should satisfy the ShopAttributeReader guard', () => {
    expect(isShopAttributeReader(setup(jest.fn()))).toBe(true);
  });

  describe('listAttributes', () => {
    it('should map attributes (not groups) by id and name, sorted by name, with the id as the slug', async () => {
      const get = serving([
        MATERIAL,
        { attribute_id: 7, attribute_group_id: 3, name: 'Gwarancja', type: 0 },
      ]);

      await expect(setup(get).listAttributes()).resolves.toEqual([
        { id: '7', name: 'Gwarancja', slug: '7' },
        { id: '12', name: 'Materiał', slug: '12' },
      ]);
      expect(get).toHaveBeenCalledWith('/attributes', {
        order: 'attribute_id ASC',
        limit: 50,
        page: 1,
      });
    });

    it('should page past Shoper’s 50-row ceiling', async () => {
      const rows = Array.from({ length: 120 }, (_, i) => ({
        attribute_id: String(i + 1),
        name: `Atrybut ${String(i + 1).padStart(3, '0')}`,
      }));
      const get = serving(rows);

      const result = await setup(get).listAttributes();

      expect(result).toHaveLength(120);
      expect(get).toHaveBeenCalledTimes(3);
    });

    it('should drop a row with no usable id or name rather than inventing a label', async () => {
      const get = serving([
        MATERIAL,
        { attribute_id: '13', name: '   ' },
        { attribute_id: null, name: 'Bez id' },
        { attribute_id: '12', name: 'Duplikat' },
      ]);

      await expect(setup(get).listAttributes()).resolves.toEqual([
        { id: '12', name: 'Materiał', slug: '12' },
      ]);
    });
  });

  describe('listAttributeTerms', () => {
    it('should read the one attribute and map its predefined options to terms, in the shop’s order', async () => {
      const get = jest.fn().mockResolvedValue({ status: 200, data: MATERIAL });

      await expect(setup(get).listAttributeTerms('12')).resolves.toEqual([
        { id: '40', name: 'Bawełna', slug: '40' },
        { id: '41', name: 'Wełna', slug: '41' },
      ]);
      expect(get).toHaveBeenCalledWith('/attributes/12');
    });

    it.each([
      ['a text-field attribute', { attribute_id: '7', name: 'Gwarancja', type: '0' }],
      ['an attribute whose options are not a list', { attribute_id: '7', name: 'X', options: null }],
      ['an empty body', null],
    ])('should return no terms for %s', async (_label, data) => {
      const get = jest.fn().mockResolvedValue({ status: 200, data });

      await expect(setup(get).listAttributeTerms('7')).resolves.toEqual([]);
    });

    it('should skip an option with no id or no value', async () => {
      const get = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          ...MATERIAL,
          options: [...(MATERIAL.options ?? []), { option_id: '42', value: '' }, { value: 'Len' }],
        },
      });

      const terms = await setup(get).listAttributeTerms('12');

      expect(terms.map((term) => term.id)).toEqual(['40', '41']);
    });

    it('should let a failure for an unknown attribute propagate', async () => {
      const error = new ShoperApiError(404, 'invalid_request', 'Resource not found');
      const get = jest.fn().mockRejectedValue(error);

      await expect(setup(get).listAttributeTerms('999')).rejects.toBe(error);
    });
  });
});
