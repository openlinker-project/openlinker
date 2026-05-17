/**
 * Resolve Categories For Batch By EAN — Tests
 *
 * Covers the 14 cases in plan §7.1: happy / no-ean variants / response-no-match
 * / multi-match / cache hits / HTTP failure / malformed response / cache
 * outages / concurrency cap / mode=GTIN / empty input.
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import type { CachePort } from '@openlinker/shared';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { resolveCategoriesForBatchByEan } from '../resolve-categories-for-batch-by-ean';

const CONNECTION_ID = 'conn-123';

describe('resolveCategoriesForBatchByEan', () => {
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
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CachePort>;
  });

  /** Build a search-response item with the EAN bearing parameter. */
  const buildCard = (overrides: {
    id: string;
    name?: string;
    ean: string;
    categoryId: string;
  }) => ({
    id: overrides.id,
    name: overrides.name,
    category: { id: overrides.categoryId },
    parameters: [
      {
        id: 'gtin-param',
        name: 'EAN',
        values: [overrides.ean],
        options: { isGTIN: true },
      },
    ],
  });

  const mockSearch = (products: ReturnType<typeof buildCard>[]) => {
    httpClient.get.mockResolvedValue({
      data: { products },
      status: 200,
      headers: {},
    });
  };

  it('case 1 — happy: 3 items all unique-matched, no cache, http called 3x', async () => {
    httpClient.get
      .mockResolvedValueOnce({
        data: { products: [buildCard({ id: 'prod-1', ean: '5901111111111', categoryId: 'cat-A' })] },
        status: 200,
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { products: [buildCard({ id: 'prod-2', ean: '5902222222222', categoryId: 'cat-B' })] },
        status: 200,
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { products: [buildCard({ id: 'prod-3', ean: '5903333333333', categoryId: 'cat-C' })] },
        status: 200,
        headers: {},
      });

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: '5901111111111' },
        { variantId: 'v2', ean: '5902222222222' },
        { variantId: 'v3', ean: '5903333333333' },
      ],
    });

    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-A',
      productCardId: 'prod-1',
    });
    expect(result.get('v2')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-B',
      productCardId: 'prod-2',
    });
    expect(result.get('v3')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-C',
      productCardId: 'prod-3',
    });
    expect(httpClient.get).toHaveBeenCalledTimes(3);
    expect(cache.set).toHaveBeenCalledTimes(3);
  });

  it('case 2 — no-EAN: ean: null collapses without HTTP', async () => {
    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: null }],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-ean' });
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('case 3 — no-EAN: empty / whitespace strings collapse identically', async () => {
    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: '' },
        { variantId: 'v2', ean: '   ' },
        { variantId: 'v3', ean: '\t\n' },
      ],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-ean' });
    expect(result.get('v2')).toEqual({ kind: 'no-ean' });
    expect(result.get('v3')).toEqual({ kind: 'no-ean' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('case 4 — no-match: empty response.data.products is cached for 24h', async () => {
    mockSearch([]);

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5904444444444' }],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-match' });
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:ean-match:conn-123:5904444444444',
      { kind: 'no-match' },
      24 * 60 * 60,
    );
  });

  it('case 5 — multi-match: candidates preserve response order, NOT cached', async () => {
    mockSearch([
      buildCard({ id: 'prod-A', name: 'Top match', ean: '5905555555555', categoryId: 'cat-1' }),
      buildCard({ id: 'prod-B', name: 'Second match', ean: '5905555555555', categoryId: 'cat-2' }),
    ]);

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5905555555555' }],
    });

    const outcome = result.get('v1');
    expect(outcome).toEqual({
      kind: 'multi-match',
      candidates: [
        { allegroCategoryId: 'cat-1', productCardId: 'prod-A', name: 'Top match' },
        { allegroCategoryId: 'cat-2', productCardId: 'prod-B', name: 'Second match' },
      ],
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('case 6 — cache hit (matched) returns from cache without HTTP', async () => {
    cache.get.mockResolvedValue({
      kind: 'matched',
      allegroCategoryId: 'cat-cached',
      productCardId: 'prod-cached',
    });

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5906666666666' }],
    });

    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-cached',
      productCardId: 'prod-cached',
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('case 7 — cache hit (no-match) returns from cache without HTTP', async () => {
    cache.get.mockResolvedValue({ kind: 'no-match' });

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5907777777777' }],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-match' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('case 8 — HTTP failure: item becomes no-match, batch continues, NOT cached', async () => {
    httpClient.get
      .mockRejectedValueOnce(new AllegroApiException('Allegro 5xx', 500, 'oops'))
      .mockResolvedValueOnce({
        data: { products: [buildCard({ id: 'prod-2', ean: '5902222222222', categoryId: 'cat-B' })] },
        status: 200,
        headers: {},
      });

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: '5901111111111' },
        { variantId: 'v2', ean: '5902222222222' },
      ],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-match' });
    expect(result.get('v2')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-B',
      productCardId: 'prod-2',
    });
    // Only the successful item's outcome should be cached.
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:ean-match:conn-123:5902222222222',
      expect.objectContaining({ kind: 'matched' }),
      24 * 60 * 60,
    );
  });

  it('case 9 — malformed response: missing products array → no-match, no crash', async () => {
    httpClient.get.mockResolvedValue({
      data: {} as unknown as { products: never[] },
      status: 200,
      headers: {},
    });

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5908888888888' }],
    });

    expect(result.get('v1')).toEqual({ kind: 'no-match' });
  });

  it('case 10 — cache.get throws (Redis down): falls through to HTTP, still returns correctly', async () => {
    cache.get.mockRejectedValue(new Error('Redis connection refused'));
    mockSearch([buildCard({ id: 'prod-1', ean: '5909999999999', categoryId: 'cat-X' })]);

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5909999999999' }],
    });

    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-X',
      productCardId: 'prod-1',
    });
    expect(httpClient.get).toHaveBeenCalled();
  });

  it('case 11 — cache.set throws (Redis down): HTTP path completes, result still returned', async () => {
    mockSearch([buildCard({ id: 'prod-1', ean: '5901010101010', categoryId: 'cat-Y' })]);
    cache.set.mockRejectedValue(new Error('Redis connection refused'));

    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5901010101010' }],
    });

    expect(result.get('v1')).toEqual({
      kind: 'matched',
      allegroCategoryId: 'cat-Y',
      productCardId: 'prod-1',
    });
  });

  it('case 12 — concurrency cap: chunks settle in batches', async () => {
    const order: string[] = [];
    httpClient.get.mockImplementation((_path, opts) => {
      const phrase = String((opts as { queryParams: { phrase: string } }).queryParams.phrase);
      order.push(`start:${phrase}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          order.push(`end:${phrase}`);
          resolve({
            data: { products: [buildCard({ id: `prod-${phrase}`, ean: phrase, categoryId: `cat-${phrase}` })] },
            status: 200,
            headers: {},
          });
        }, 5);
      });
    });

    await resolveCategoriesForBatchByEan(
      httpClient,
      undefined, // no cache — keep test focused on throttling
      CONNECTION_ID,
      {
        items: Array.from({ length: 6 }, (_, i) => ({
          variantId: `v${i}`,
          ean: `5900000000${i.toString().padStart(3, '0')}`,
        })),
      },
      { concurrency: 2 },
    );

    // First 2 calls must both start before any of them ends.
    const firstChunkStarts = order.slice(0, 2).filter((e) => e.startsWith('start:'));
    expect(firstChunkStarts).toHaveLength(2);
    // The 3rd call must start AFTER at least one of the first chunk has ended.
    const thirdStartIdx = order.findIndex((e, i) => i >= 2 && e.startsWith('start:'));
    const firstEndIdx = order.findIndex((e) => e.startsWith('end:'));
    expect(thirdStartIdx).toBeGreaterThan(firstEndIdx);
  });

  it('case 13 — passes mode=GTIN on the search call', async () => {
    mockSearch([buildCard({ id: 'prod-1', ean: '5901212121212', categoryId: 'cat-1' })]);

    await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5901212121212' }],
    });

    expect(httpClient.get).toHaveBeenCalledWith('/sale/products', {
      queryParams: { phrase: '5901212121212', mode: 'GTIN', limit: 10 },
    });
  });

  it('case 14 — empty input: returns empty Map, no HTTP, no cache', async () => {
    const result = await resolveCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [],
    });

    expect(result.size).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('uses connection-scoped cache key', async () => {
    cache.get.mockResolvedValue(null);
    mockSearch([buildCard({ id: 'prod-1', ean: '5901313131313', categoryId: 'cat-Z' })]);

    await resolveCategoriesForBatchByEan(httpClient, cache, 'conn-XYZ', {
      items: [{ variantId: 'v1', ean: '5901313131313' }],
    });

    expect(cache.get).toHaveBeenCalledWith('allegro:ean-match:conn-XYZ:5901313131313');
  });
});
