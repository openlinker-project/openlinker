import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { envelope } from '../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../shoper-http-client';
import {
  SHOPER_MAX_PAGE_SIZE,
  assertShoperPageSize,
  fetchShoperPage,
} from '../shoper-pagination';

function clientReturning(data: unknown): { client: ShoperHttpClient; get: jest.Mock } {
  const get = jest.fn().mockResolvedValue({ status: 200, data });
  return { client: { get } as unknown as ShoperHttpClient, get };
}

describe('assertShoperPageSize', () => {
  it.each([1, 10, SHOPER_MAX_PAGE_SIZE])('should accept a page size of %i', (limit) => {
    expect(() => assertShoperPageSize(limit, 'op')).not.toThrow();
  });

  it('should refuse a size above 50, which Shoper would silently shrink to 10', () => {
    expect(() => assertShoperPageSize(51, 'op')).toThrow(/maximum of 50/);
    expect(() => assertShoperPageSize(500, 'op')).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN])('should refuse the invalid size %p', (limit) => {
    expect(() => assertShoperPageSize(limit, 'op')).toThrow(RangeError);
  });
});

describe('fetchShoperPage', () => {
  it('should send page and limit alongside the caller query and parse the string count', async () => {
    const { client, get } = clientReturning(envelope([{ id: 1 }], { count: 36, pages: 12, page: 2 }));

    const result = await fetchShoperPage<{ id: number }>(client, '/products', {
      page: 2,
      limit: 3,
      query: { order: 'product_id ASC' },
    });

    expect(get).toHaveBeenCalledWith('/products', { order: 'product_id ASC', limit: 3, page: 2 });
    expect(result).toEqual({ items: [{ id: 1 }], page: 2, pages: 12, count: 36 });
  });

  it('should refuse an oversized page before making any request', async () => {
    const { client, get } = clientReturning(envelope([]));

    await expect(fetchShoperPage(client, '/products', { page: 1, limit: 100 })).rejects.toThrow(
      RangeError,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['no list', { count: '1', pages: 1, page: 1 }],
    ['a non-numeric pages', { count: '1', pages: '1', page: 1, list: [] }],
    ['a non-numeric count', { count: 'x', pages: 1, page: 1, list: [] }],
  ])('should reject an unreadable envelope with %s', async (_label, data) => {
    const { client } = clientReturning(data);

    await expect(
      fetchShoperPage(client, '/products', { page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(ShoperNetworkError);
  });
});
