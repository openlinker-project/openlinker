/**
 * Fetch Allegro Product — Tests
 *
 * Covers the contract documented in the util's JSDoc: cache hit short-
 * circuits, miss → fetch → map → cache, 404 → `CatalogProductNotFoundException`,
 * non-404 errors bubble unchanged. Mapper behaviour (Allegro
 * `SaleProductDto` → neutral `CatalogProduct`) gets its own table-driven block.
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import type { CachePort } from '@openlinker/shared';
import { CatalogProductNotFoundException } from '@openlinker/core/listings';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { fetchAllegroProduct, mapAllegroProductDtoToNeutral } from '../fetch-allegro-product';

describe('fetchAllegroProduct', () => {
  let httpClient: jest.Mocked<IAllegroHttpClient>;
  let cache: jest.Mocked<CachePort>;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      postBinary: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    cache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<CachePort>;
  });

  it('returns cached product without hitting Allegro on cache HIT', async () => {
    const cached = { id: 'p1', name: 'Cached', parameters: [] };
    cache.get.mockResolvedValue(cached);

    const result = await fetchAllegroProduct(httpClient, cache, 'p1');

    expect(result).toBe(cached);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('cache MISS → fetches, maps to neutral, caches under productId', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockResolvedValue({
      data: {
        id: 'p1',
        name: 'iPhone 5s',
        images: [{ url: 'https://img/a.jpg' }, { url: 'https://img/b.jpg' }],
        parameters: [
          {
            id: '224017',
            name: 'Manufacturer code',
            values: ['4234'],
            valuesIds: ['129970_850936'],
          },
          {
            id: 'gtin-param',
            name: 'EAN',
            values: ['5901234123457'],
            options: { isGTIN: true },
          },
        ],
      },
      status: 200,
      headers: {},
    });

    const result = await fetchAllegroProduct(httpClient, cache, 'p1');

    expect(httpClient.get).toHaveBeenCalledWith('/sale/products/p1');
    expect(result).toEqual({
      id: 'p1',
      name: 'iPhone 5s',
      ean: '5901234123457',
      imageUrl: 'https://img/a.jpg',
      images: ['https://img/a.jpg', 'https://img/b.jpg'],
      parameters: [
        {
          parameterId: '224017',
          name: 'Manufacturer code',
          valueIds: ['129970_850936'],
          valueStrings: ['4234'],
        },
        {
          parameterId: 'gtin-param',
          name: 'EAN',
          valueStrings: ['5901234123457'],
        },
      ],
    });
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:product-detail:p1',
      expect.objectContaining({ id: 'p1', name: 'iPhone 5s' }),
      expect.any(Number)
    );
  });

  it('url-encodes the productId in the request path', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockResolvedValue({
      data: { id: 'p with spaces', name: 'X', parameters: [] },
      status: 200,
      headers: {},
    });

    await fetchAllegroProduct(httpClient, cache, 'p with spaces');

    expect(httpClient.get).toHaveBeenCalledWith('/sale/products/p%20with%20spaces');
  });

  it('translates Allegro 404 into CatalogProductNotFoundException; does NOT cache', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockRejectedValue(
      new AllegroApiException('Not found', 404, '{"errors":[]}', '/sale/products/missing')
    );

    await expect(fetchAllegroProduct(httpClient, cache, 'missing')).rejects.toBeInstanceOf(
      CatalogProductNotFoundException
    );
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('bubbles non-404 Allegro errors unchanged', async () => {
    cache.get.mockResolvedValue(null);
    const err = new AllegroApiException('Boom', 500, '{}', '/sale/products/p1');
    httpClient.get.mockRejectedValue(err);

    await expect(fetchAllegroProduct(httpClient, cache, 'p1')).rejects.toBe(err);
  });

  it('works without a cache (cache=undefined → straight fetch + map)', async () => {
    httpClient.get.mockResolvedValue({
      data: { id: 'p1', name: 'X', parameters: [] },
      status: 200,
      headers: {},
    });

    const result = await fetchAllegroProduct(httpClient, undefined, 'p1');
    expect(result.id).toBe('p1');
  });
});

describe('mapAllegroProductDtoToNeutral', () => {
  it('handles empty optional fields', () => {
    expect(mapAllegroProductDtoToNeutral({ id: 'p', name: 'N' })).toEqual({
      id: 'p',
      name: 'N',
      ean: undefined,
      imageUrl: undefined,
      images: undefined,
      parameters: [],
    });
  });

  it('falls back parameter.name to parameter.id when name missing', () => {
    const result = mapAllegroProductDtoToNeutral({
      id: 'p',
      name: 'N',
      parameters: [{ id: '999', values: ['v'] }],
    });
    expect(result.parameters[0]).toEqual({
      parameterId: '999',
      name: '999',
      valueStrings: ['v'],
    });
  });

  it('omits valueIds/valueStrings when arrays are empty', () => {
    const result = mapAllegroProductDtoToNeutral({
      id: 'p',
      name: 'N',
      parameters: [{ id: '1', name: 'P', values: [], valuesIds: [] }],
    });
    expect(result.parameters[0]).toEqual({
      parameterId: '1',
      name: 'P',
      valueIds: undefined,
      valueStrings: undefined,
    });
  });

  it('does not surface EAN when no parameter carries options.isGTIN', () => {
    const result = mapAllegroProductDtoToNeutral({
      id: 'p',
      name: 'N',
      parameters: [{ id: '1', name: 'EAN-named', values: ['5901234123457'] }],
    });
    expect(result.ean).toBeUndefined();
  });

  it('skips images entry without a url field', () => {
    const result = mapAllegroProductDtoToNeutral({
      id: 'p',
      name: 'N',
      images: [{ url: 'https://ok' }, { url: undefined as unknown as string }],
    });
    expect(result.images).toEqual(['https://ok']);
    expect(result.imageUrl).toBe('https://ok');
  });
});
