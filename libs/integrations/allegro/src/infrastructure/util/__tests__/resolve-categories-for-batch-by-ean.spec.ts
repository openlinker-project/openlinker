/**
 * Resolve Categories For Batch By EAN — Tests
 *
 * Covers the 14 cases in plan §7.1: happy / no-ean variants / response-no-match
 * / multi-match / cache hits / HTTP failure / malformed response / cache
 * outages / concurrency cap / mode=GTIN / empty input.
 *
 * The second suite covers the streaming sibling (#2208): incremental delivery
 * before its wave settles, plus the cache, no-throw, concurrency and abort
 * guarantees the batch path must keep sharing with it.
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import type { CachePort } from '@openlinker/shared';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import {
  resolveBatchConcurrency,
  resolveCategoriesForBatchByEan,
  resolveStreamConcurrency,
  streamCategoriesForBatchByEan,
} from '../resolve-categories-for-batch-by-ean';

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

describe('streamCategoriesForBatchByEan (#2208)', () => {
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
      { id: 'gtin-param', name: 'EAN', values: [overrides.ean], options: { isGTIN: true } },
    ],
  });

  /**
   * Hand the test control over when each per-EAN call settles, which is the
   * only way to observe that a result is delivered before its wave finishes.
   */
  const gateCallsByPhrase = (): {
    started: string[];
    settle: (phrase: string, products: ReturnType<typeof buildCard>[]) => void;
    fail: (phrase: string, err: Error) => void;
  } => {
    const started: string[] = [];
    const gates = new Map<string, { ok: (v: unknown) => void; ko: (e: unknown) => void }>();
    httpClient.get.mockImplementation((_path, opts) => {
      const phrase = String((opts as { queryParams: { phrase: string } }).queryParams.phrase);
      started.push(phrase);
      return new Promise((resolve, reject) => {
        gates.set(phrase, { ok: resolve as (v: unknown) => void, ko: reject });
      });
    });
    const gateFor = (phrase: string) => {
      const gate = gates.get(phrase);
      if (!gate) throw new Error(`No in-flight call for phrase ${phrase}`);
      return gate;
    };
    return {
      started,
      settle: (phrase, products) =>
        gateFor(phrase).ok({ data: { products }, status: 200, headers: {} }),
      fail: (phrase, err) => gateFor(phrase).ko(err),
    };
  };

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('yields a variant as soon as it settles, without waiting for its wave', async () => {
    const gates = gateCallsByPhrase();
    const stream = streamCategoriesForBatchByEan(httpClient, undefined, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: '5901111111111' },
        { variantId: 'v2', ean: '5902222222222' },
        { variantId: 'v3', ean: '5903333333333' },
      ],
    });

    const first = stream.next();
    await flush();
    expect(gates.started).toEqual(['5901111111111', '5902222222222', '5903333333333']);

    // The middle item lands first; the other two are still in flight.
    gates.settle('5902222222222', [
      buildCard({ id: 'prod-2', ean: '5902222222222', categoryId: 'cat-B' }),
    ]);

    await expect(first).resolves.toEqual({
      done: false,
      value: {
        variantId: 'v2',
        result: { kind: 'matched', allegroCategoryId: 'cat-B', productCardId: 'prod-2' },
      },
    });

    gates.settle('5901111111111', []);
    gates.settle('5903333333333', []);
    const rest: string[] = [];
    for await (const item of stream) {
      rest.push(item.variantId);
    }
    expect(rest.sort()).toEqual(['v1', 'v3']);
  });

  it('yields no-ean variants up front and never calls Allegro for them', async () => {
    const gates = gateCallsByPhrase();
    const stream = streamCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: null },
        { variantId: 'v2', ean: '   ' },
        { variantId: 'v3', ean: '5904444444444' },
      ],
    });

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { variantId: 'v1', result: { kind: 'no-ean' } },
    });
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { variantId: 'v2', result: { kind: 'no-ean' } },
    });
    expect(gates.started).toEqual([]);

    // The wave is scheduled lazily, so the call only starts once the consumer
    // asks for the item past the free no-ean verdicts.
    const third = stream.next();
    await flush();
    expect(gates.started).toEqual(['5904444444444']);

    gates.settle('5904444444444', []);
    await expect(third).resolves.toEqual({
      done: false,
      value: { variantId: 'v3', result: { kind: 'no-match' } },
    });
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('serves a cache hit without an HTTP call', async () => {
    cache.get.mockResolvedValue({
      kind: 'matched',
      allegroCategoryId: 'cat-cached',
      productCardId: 'prod-cached',
    });

    const yielded = [];
    for await (const item of streamCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5906666666666' }],
    })) {
      yielded.push(item);
    }

    expect(yielded).toEqual([
      {
        variantId: 'v1',
        result: { kind: 'matched', allegroCategoryId: 'cat-cached', productCardId: 'prod-cached' },
      },
    ]);
    expect(cache.get).toHaveBeenCalledWith('allegro:ean-match:conn-123:5906666666666');
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('does not cache a multi-match', async () => {
    httpClient.get.mockResolvedValue({
      data: {
        products: [
          buildCard({ id: 'prod-A', name: 'First', ean: '5905555555555', categoryId: 'cat-1' }),
          buildCard({ id: 'prod-B', name: 'Second', ean: '5905555555555', categoryId: 'cat-2' }),
        ],
      },
      status: 200,
      headers: {},
    });

    const yielded = [];
    for await (const item of streamCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [{ variantId: 'v1', ean: '5905555555555' }],
    })) {
      yielded.push(item);
    }

    expect(yielded[0].result).toEqual({
      kind: 'multi-match',
      candidates: [
        { allegroCategoryId: 'cat-1', productCardId: 'prod-A', name: 'First' },
        { allegroCategoryId: 'cat-2', productCardId: 'prod-B', name: 'Second' },
      ],
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('yields no-match on a per-item HTTP failure, keeps streaming, and caches nothing for it', async () => {
    const gates = gateCallsByPhrase();
    const stream = streamCategoriesForBatchByEan(httpClient, cache, CONNECTION_ID, {
      items: [
        { variantId: 'v1', ean: '5901111111111' },
        { variantId: 'v2', ean: '5902222222222' },
      ],
    });

    const first = stream.next();
    await flush();
    gates.fail('5901111111111', new AllegroApiException('Allegro 5xx', 500, 'oops'));

    await expect(first).resolves.toEqual({
      done: false,
      value: { variantId: 'v1', result: { kind: 'no-match' } },
    });

    gates.settle('5902222222222', [
      buildCard({ id: 'prod-2', ean: '5902222222222', categoryId: 'cat-B' }),
    ]);
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: {
        variantId: 'v2',
        result: { kind: 'matched', allegroCategoryId: 'cat-B', productCardId: 'prod-2' },
      },
    });
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'allegro:ean-match:conn-123:5902222222222',
      expect.objectContaining({ kind: 'matched' }),
      24 * 60 * 60,
    );
  });

  it('keeps the batch collector in-flight cap at 3', async () => {
    // A batch caller blocks on the whole map, so it gains nothing from a wider
    // cap and would only spend more of the rate limit at once (#2215).
    const gates = gateCallsByPhrase();
    const pending = resolveCategoriesForBatchByEan(httpClient, undefined, CONNECTION_ID, {
      items: Array.from({ length: 5 }, (_, i) => ({
        variantId: `v${i}`,
        ean: `590000000000${i}`,
      })),
    });

    await flush();
    expect(gates.started).toHaveLength(3);

    gates.settle('5900000000000', []);
    gates.settle('5900000000001', []);
    gates.settle('5900000000002', []);
    await flush();
    expect(gates.started).toHaveLength(5);

    gates.settle('5900000000003', []);
    gates.settle('5900000000004', []);
    await expect(pending).resolves.toBeInstanceOf(Map);
  });

  it('streams at the wider in-flight cap', async () => {
    // The streaming path exists so results land continuously, and the wizard's
    // pre-#2208 chunking already sustained this many in flight (#2215).
    // Asserted against a LITERAL, not against whatever the resolver reports: a
    // test written in terms of the adapter's own number stays green if someone
    // reverts it to the batch default, which is exactly the regression worth
    // catching (#2215).
    expect(resolveStreamConcurrency().adapterDefault).toBe(9);
    const total = 9 + 3;
    const gates = gateCallsByPhrase();
    const stream = streamCategoriesForBatchByEan(httpClient, undefined, CONNECTION_ID, {
      items: Array.from({ length: total }, (_, i) => ({
        variantId: `v${i}`,
        ean: `59000000000${String(i).padStart(2, '0')}`,
      })),
    });

    const first = stream.next();
    await flush();
    expect(gates.started).toHaveLength(9);

    const drained: string[] = [];
    const rest = (async (): Promise<void> => {
      const head = await first;
      if (!head.done) drained.push(head.value.variantId);
      for await (const item of stream) {
        drained.push(item.variantId);
      }
    })();
    // Settling repeatedly is safe: the gate map keeps its entries, so a second
    // resolve on an already-settled promise is a no-op.
    for (let round = 0; round < 4; round += 1) {
      for (const phrase of [...gates.started]) {
        gates.settle(phrase, []);
      }
      await flush();
    }
    await rest;
    expect(drained).toHaveLength(total);
    expect(gates.started).toHaveLength(total);
  });

  it('stops scheduling further waves once the signal aborts', async () => {
    const gates = gateCallsByPhrase();
    const controller = new AbortController();
    const stream = streamCategoriesForBatchByEan(
      httpClient,
      undefined,
      CONNECTION_ID,
      {
        items: [
          { variantId: 'v1', ean: '5901111111111' },
          { variantId: 'v2', ean: '5902222222222' },
        ],
      },
      { concurrency: 1, signal: controller.signal },
    );

    const first = stream.next();
    await flush();
    gates.settle('5901111111111', []);
    await expect(first).resolves.toEqual({
      done: false,
      value: { variantId: 'v1', result: { kind: 'no-match' } },
    });

    controller.abort();
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
    expect(gates.started).toEqual(['5901111111111']);
  });

  it('ends the iteration on abort without waiting for the in-flight wave', async () => {
    const gates = gateCallsByPhrase();
    const controller = new AbortController();
    const stream = streamCategoriesForBatchByEan(
      httpClient,
      undefined,
      CONNECTION_ID,
      {
        items: Array.from({ length: 5 }, (_, i) => ({
          variantId: `v${i}`,
          ean: `590000000000${i}`,
        })),
      },
      { concurrency: 3, signal: controller.signal },
    );

    const pending = stream.next();
    await flush();
    // Three calls are genuinely outstanding: no gate is ever released below,
    // so anything that awaited them would never settle.
    expect(gates.started).toHaveLength(3);

    controller.abort();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(gates.started).toHaveLength(3);
  });

  it('produces the same map as the batch collector for the same input', async () => {
    httpClient.get.mockImplementation((_path, opts) => {
      const phrase = String((opts as { queryParams: { phrase: string } }).queryParams.phrase);
      return Promise.resolve({
        data: {
          products: [buildCard({ id: `prod-${phrase}`, ean: phrase, categoryId: `cat-${phrase}` })],
        },
        status: 200,
        headers: {},
      });
    });
    const input = {
      items: [
        { variantId: 'v1', ean: '5901111111111' },
        { variantId: 'v2', ean: null },
        { variantId: 'v3', ean: '5903333333333' },
      ],
    };

    const streamed = new Map<string, unknown>();
    for await (const item of streamCategoriesForBatchByEan(
      httpClient,
      undefined,
      CONNECTION_ID,
      input,
    )) {
      streamed.set(item.variantId, item.result);
    }
    const collected = await resolveCategoriesForBatchByEan(
      httpClient,
      undefined,
      CONNECTION_ID,
      input,
    );

    expect(Object.fromEntries(streamed)).toEqual(Object.fromEntries(collected));
    expect(collected.get('v2')).toEqual({ kind: 'no-ean' });
  });
});

describe('resolveStreamConcurrency (#2229)', () => {
  it('reports the adapter default when the operator configured no cap', () => {
    expect(resolveStreamConcurrency(undefined)).toEqual({
      maxInFlight: 9,
      source: 'adapter-default',
      adapterDefault: 9,
    });
  });

  it('clamps down to the operator cap and names what it clamped', () => {
    expect(resolveStreamConcurrency(4)).toEqual({
      maxInFlight: 4,
      source: 'connection-config',
      adapterDefault: 9,
    });
  });

  it('never lets the operator cap RAISE the adapter ceiling', () => {
    // `maxConcurrent` is a safety valve on the operator's own quota. Letting a
    // generous value lift the adapter's pacing would turn a cap into a
    // throttle-release, which is not what the field says it does.
    expect(resolveStreamConcurrency(64).maxInFlight).toBe(9);
    expect(resolveStreamConcurrency(64).source).toBe('adapter-default');
    expect(resolveStreamConcurrency(9).source).toBe('adapter-default');
  });

  it('ignores a non-positive or non-finite cap rather than stalling every run', () => {
    // A 0 ceiling would schedule nothing and hang the resolve step with no
    // error anywhere — strictly worse than ignoring a nonsense value.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveStreamConcurrency(bad).maxInFlight).toBe(9);
    }
  });

  it('ignores a cap that is not a number at all', () => {
    // `Connection.config` is JSONB, so `maxConcurrent` can arrive as the string
    // an operator typed into a hand-edited config rather than as a number.
    for (const bad of ['4', null, {}, [], true]) {
      expect(resolveStreamConcurrency(bad).maxInFlight).toBe(9);
    }
  });

  it('floors a fractional cap instead of passing it to the scheduler', () => {
    expect(resolveStreamConcurrency(4.7).maxInFlight).toBe(4);
  });
});

describe('resolveBatchConcurrency (#2229 review)', () => {
  it('reports the narrower batch default, not the streamed one', () => {
    expect(resolveBatchConcurrency(undefined)).toEqual({
      maxInFlight: 3,
      source: 'adapter-default',
      adapterDefault: 3,
    });
  });

  it('honours the operator cap on the batch path too', () => {
    // The batch path used to be the one resolve path outside both the clamp and
    // the declared ceiling.
    expect(resolveBatchConcurrency(2)).toEqual({
      maxInFlight: 2,
      source: 'connection-config',
      adapterDefault: 3,
    });
  });

  it('never lets a generous cap widen the batch default', () => {
    expect(resolveBatchConcurrency(50).maxInFlight).toBe(3);
    expect(resolveBatchConcurrency(50).source).toBe('adapter-default');
  });
});
