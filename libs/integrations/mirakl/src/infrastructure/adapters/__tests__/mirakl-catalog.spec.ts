/**
 * Mirakl Catalogue: unit tests
 *
 * Shapes follow Empik staging (SPIKE-4268): H11 returns the asked node's
 * ancestors and `max_level` levels below it.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklRequestOptions } from '../../http/mirakl-http-client.types';
import { MiraklCatalog } from '../mirakl-catalog';

function catalog(get: jest.Mock): MiraklCatalog {
  return new MiraklCatalog('conn-1', { get } as unknown as IMiraklHttpClient);
}

describe('MiraklCatalog.fetchCategories', () => {
  it('should return the children of a node, a child with no children read as a leaf', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        hierarchies: [
          { code: '8', label: 'Książki', level: 1, parent_code: '' },
          { code: '8-853', label: 'Literatura', level: 2, parent_code: '8' },
          { code: '8-853-1', label: 'Młodzieżowa', level: 3, parent_code: '8-853' },
          { code: '8-900', label: 'Inne', level: 2, parent_code: '8' },
        ],
      },
    });

    const categories = await catalog(get).fetchCategories('8');

    expect(get).toHaveBeenCalledWith('/api/hierarchies', {
      queryParams: { hierarchy: '8', max_level: 2 },
    });
    expect(categories).toEqual([
      { id: '8-853', name: 'Literatura', parentId: '8', leaf: false },
      { id: '8-900', name: 'Inne', parentId: '8', leaf: true },
    ]);
  });

  it('should read the roots without a hierarchy filter', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        hierarchies: [
          { code: '11', label: 'Zdrowie', level: 1, parent_code: '' },
          { code: '11-1', label: 'Leki', level: 2, parent_code: '11' },
        ],
      },
    });

    expect(await catalog(get).fetchCategories()).toEqual([
      { id: '11', name: 'Zdrowie', parentId: null, leaf: false },
    ]);
    expect(get).toHaveBeenCalledWith('/api/hierarchies', { queryParams: { max_level: 2 } });
  });
});

describe('MiraklCatalog.fetchCategoryParameters', () => {
  it('should map PM11 attributes and read each value list once', async () => {
    const get = jest.fn((path: string, options?: MiraklRequestOptions) => {
      if (path === '/api/products/attributes') {
        return Promise.resolve({
          status: 200,
          data: {
            attributes: [
              { code: '650', label: 'Zestaw', type: 'LIST', values_list: 'TAK_NIE' },
              { code: 'X', label: 'Inne', type: 'LIST', values_list: 'TAK_NIE' },
              { code: '2039', label: 'Liczba sztuk', type: 'INTEGER' },
            ],
          },
        });
      }
      return Promise.resolve({
        status: 200,
        data: {
          values_lists: [
            { code: options?.queryParams?.code, values: [{ code: 'Y', label: 'Tak' }] },
          ],
        },
      });
    });

    const parameters = await catalog(get).fetchCategoryParameters({ categoryId: '8-853-1' });

    expect(parameters.map((parameter) => [parameter.id, parameter.type])).toEqual([
      ['650', 'dictionary'],
      ['X', 'dictionary'],
      ['2039', 'integer'],
    ]);
    expect(get.mock.calls.filter(([path]) => path === '/api/values_lists')).toHaveLength(1);
  });
});

describe('MiraklCatalog.fetchCategoryParameters duplicates', () => {
  it('should merge an attribute PM11 lists per hierarchy level into one, required if any level is', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        attributes: [
          { code: 'PELNY_TYTUL', label: 'Tytuł', type: 'TEXT', hierarchy_code: '', required: false },
          { code: 'PELNY_TYTUL', label: 'Tytuł', type: 'TEXT', hierarchy_code: '8', required: true },
        ],
      },
    });

    const parameters = await catalog(get).fetchCategoryParameters({ categoryId: '8-853-1' });

    expect(parameters).toEqual([expect.objectContaining({ id: 'PELNY_TYTUL', required: true })]);
  });
});

describe('MiraklCatalog.resolveCategoriesForBatchByEan', () => {
  it('should match one card, flag several, and answer no-ean and no-match', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        products: [
          { product_id: '111', product_sku: 'C1', category_code: '8-853-1', product_title: 'A' },
          { product_id: '222', product_sku: 'C2', category_code: '8-1', product_title: 'B' },
          { product_id: '222', product_sku: 'C3', category_code: '8-2', product_title: 'C' },
        ],
      },
    });

    const result = await catalog(get).resolveCategoriesForBatchByEan({
      items: [
        { variantId: 'v1', ean: '111' },
        { variantId: 'v2', ean: '222' },
        { variantId: 'v3', ean: '333' },
        { variantId: 'v4', ean: null },
      ],
    });

    expect(get).toHaveBeenCalledWith('/api/products', {
      queryParams: { product_references: 'EAN|111,EAN|222,EAN|333' },
    });
    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: '8-853-1',
      productCardId: 'C1',
    });
    expect(result.get('v2')).toMatchObject({ kind: 'multi-match' });
    expect(result.get('v3')).toEqual({ kind: 'no-match' });
    expect(result.get('v4')).toEqual({ kind: 'no-ean' });
  });

  it('should answer no-match, never throw, when the lookup fails', async () => {
    const get = jest.fn().mockRejectedValue(new MiraklApiException('down', 500));

    const result = await catalog(get).resolveCategoriesForBatchByEan({
      items: [{ variantId: 'v1', ean: '111' }],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-match' });
  });
});
