import type { CachePort } from '@openlinker/shared';

import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyIdPager, type ShopifyIdPagerSpec } from '../shopify-id-pager';

interface Node {
  readonly id: string;
  readonly skip?: boolean;
}

/** A fake catalogue of `count` ids served in pages of `pageSize`, cursor = index of the next page. */
function catalogue(count: number, skipEvery = 0): ShopifyGraphqlClient & { query: jest.Mock } {
  const nodes: Node[] = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    skip: skipEvery > 0 && (i + 1) % skipEvery === 0,
  }));
  const query = jest.fn((_doc: string, vars: { first: number; after: string | null }) => {
    const start = vars.after === null ? 0 : Number(vars.after);
    const page = nodes.slice(start, start + vars.first);
    const next = start + vars.first;
    return Promise.resolve({
      products: { nodes: page, pageInfo: { hasNextPage: next < nodes.length, endCursor: String(next) } },
    });
  });
  return { query } as unknown as ShopifyGraphqlClient & { query: jest.Mock };
}

function memoryCache(): CachePort {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => Promise.resolve((store.get(key) ?? null) as never)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: jest.fn(),
  } as unknown as CachePort;
}

const SPEC: ShopifyIdPagerSpec<Node> = {
  kind: 'catalogue',
  document: 'q',
  pageSize: 10,
  field: 'products',
  idOf: (n) => (n.skip === true ? null : n.id),
};

describe('ShopifyIdPager', () => {
  it('should serve an offset window over the cursor pages', async () => {
    const pager = new ShopifyIdPager(catalogue(35), undefined, 'c1');

    await expect(pager.window(SPEC, 12, 5)).resolves.toEqual(['13', '14', '15', '16', '17']);
  });

  it('should return a short last window and stop at the end', async () => {
    const pager = new ShopifyIdPager(catalogue(35), undefined, 'c1');

    await expect(pager.window(SPEC, 30, 10)).resolves.toEqual(['31', '32', '33', '34', '35']);
  });

  it('should resume the next window of a sweep from the checkpoint instead of walking from the start', async () => {
    const graphql = catalogue(100);
    const pager = new ShopifyIdPager(graphql, memoryCache(), 'c1');

    await pager.window(SPEC, 0, 25);
    graphql.query.mockClear();
    const next = await pager.window(SPEC, 25, 25);

    expect(next).toEqual(Array.from({ length: 25 }, (_, i) => String(i + 26)));
    // Resumed at the page holding position 20, so only pages 20, 30, 40 are read.
    expect(graphql.query).toHaveBeenCalledTimes(3);
  });

  it('should walk from the start for a window before the checkpoint', async () => {
    const graphql = catalogue(100);
    const pager = new ShopifyIdPager(graphql, memoryCache(), 'c1');
    await pager.window(SPEC, 50, 10);

    await expect(pager.window(SPEC, 0, 5)).resolves.toEqual(['1', '2', '3', '4', '5']);
  });

  it('should count only the ids it keeps, so positions stay consistent between windows', async () => {
    const pager = new ShopifyIdPager(catalogue(30, 3), memoryCache(), 'c1');

    const first = await pager.window(SPEC, 0, 5);
    const second = await pager.window(SPEC, 5, 5);

    expect(first).toEqual(['1', '2', '4', '5', '7']);
    expect(second).toEqual(['8', '10', '11', '13', '14']);
  });

  it('should walk from the start when Shopify rejects the resumed cursor', async () => {
    const graphql = catalogue(40);
    const pager = new ShopifyIdPager(graphql, memoryCache(), 'c1');
    await pager.window(SPEC, 0, 25);
    graphql.query.mockImplementationOnce(() =>
      Promise.reject(new ShopifyGraphqlError([''], ['Invalid cursor for current pagination sort.'])),
    );

    await expect(pager.window(SPEC, 25, 5)).resolves.toEqual(['26', '27', '28', '29', '30']);
  });

  it('should let a throttle out instead of re-reading every page from the start', async () => {
    const graphql = catalogue(40);
    const pager = new ShopifyIdPager(graphql, memoryCache(), 'c1');
    await pager.window(SPEC, 0, 25);
    const throttled = new ShopifyGraphqlError(['THROTTLED'], ['Throttled']);
    graphql.query.mockClear();
    graphql.query.mockImplementationOnce(() => Promise.reject(throttled));

    await expect(pager.window(SPEC, 25, 5)).rejects.toBe(throttled);
    expect(graphql.query).toHaveBeenCalledTimes(1);
  });
});
