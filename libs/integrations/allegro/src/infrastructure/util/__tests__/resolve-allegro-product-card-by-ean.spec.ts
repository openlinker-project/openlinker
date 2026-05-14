/**
 * Resolve Allegro Product Card By EAN — Tests
 *
 * Branches: cache hit (unique + no_match), miss → unique, miss → ambiguous
 * (not cached), miss → no_match (cached), HTTP failure (no_match, not
 * cached). Covers the contract documented in the util's JSDoc.
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import type { CachePort } from '@openlinker/shared';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { resolveAllegroProductCardByEan } from '../resolve-allegro-product-card-by-ean';

describe('resolveAllegroProductCardByEan', () => {
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

  it('returns cached unique without hitting Allegro on cache HIT', async () => {
    cache.get.mockResolvedValue({ kind: 'unique', productId: 'allegro-prod-cached' });

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'unique', productId: 'allegro-prod-cached' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('returns cached no_match without hitting Allegro on cache HIT', async () => {
    cache.get.mockResolvedValue({ kind: 'no_match' });

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'no_match' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('cache MISS → fetches, returns unique on exactly one EAN match, caches the productId', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockResolvedValue({
      data: {
        products: [
          { id: 'allegro-prod-1', name: 'Canon SX740', ean: '5901234123457' },
          { id: 'allegro-prod-2', name: 'Other', ean: '9999999999999' }, // fuzzy match, filtered
        ],
      },
      status: 200,
      headers: {},
    });

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'unique', productId: 'allegro-prod-1' });
    expect(httpClient.get).toHaveBeenCalledWith('/sale/products', {
      queryParams: { phrase: '5901234123457', 'category.id': 'cat-1', limit: 10 },
    });
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:product-card:cat-1:5901234123457',
      { kind: 'unique', productId: 'allegro-prod-1' },
      expect.any(Number)
    );
  });

  it('cache MISS → returns ambiguous when multiple cards match exactly; does NOT cache', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockResolvedValue({
      data: {
        products: [
          { id: 'allegro-prod-1', name: 'Variant A', ean: '5901234123457' },
          { id: 'allegro-prod-2', name: 'Variant B', ean: '5901234123457' },
        ],
      },
      status: 200,
      headers: {},
    });

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.matches).toHaveLength(2);
    }
    // Ambiguous results re-evaluate next call — never cached.
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('cache MISS → returns no_match (and caches it) when zero exact-EAN matches', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockResolvedValue({
      data: {
        products: [{ id: 'allegro-prod-1', name: 'Fuzzy match', ean: '9999999999999' }],
      },
      status: 200,
      headers: {},
    });

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'no_match' });
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:product-card:cat-1:5901234123457',
      { kind: 'no_match' },
      expect.any(Number)
    );
  });

  it('returns no_match without throwing when Allegro responds with an error; does NOT cache', async () => {
    cache.get.mockResolvedValue(null);
    httpClient.get.mockRejectedValue(
      new AllegroApiException(
        'Internal',
        500,
        '{"errors":[{"code":"INTERNAL"}]}',
        'https://api.allegro.pl/sale/products'
      )
    );

    const result = await resolveAllegroProductCardByEan(httpClient, cache, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'no_match' });
    // HTTP failure is transient — do NOT cache, so the next attempt re-evaluates.
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('works without a cache (degrades to no caching)', async () => {
    httpClient.get.mockResolvedValue({
      data: {
        products: [{ id: 'allegro-prod-1', ean: '5901234123457' }],
      },
      status: 200,
      headers: {},
    });

    const result = await resolveAllegroProductCardByEan(httpClient, undefined, {
      ean: '5901234123457',
      categoryId: 'cat-1',
    });

    expect(result).toEqual({ kind: 'unique', productId: 'allegro-prod-1' });
  });
});
