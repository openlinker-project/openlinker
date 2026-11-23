/**
 * Mirakl Pagination: unit tests
 *
 * Both readers stop where the list ends, and report `truncated` when
 * `maxPages` stops them first, so a partial read is never passed off as whole.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 */
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import type { IMiraklHttpClient } from '../mirakl-http-client.interface';
import { listAllOffset, listAllSeek } from '../mirakl-pagination';

function callOptions(get: jest.Mock, index: number): unknown {
  return (get.mock.calls[index] as unknown[])[1];
}

function clientReturning(pages: unknown[]): { client: IMiraklHttpClient; get: jest.Mock } {
  const get = jest.fn();
  for (const page of pages) {
    get.mockResolvedValueOnce({ status: 200, data: page });
  }
  return { client: { get } as unknown as IMiraklHttpClient, get };
}

describe('listAllOffset', () => {
  it('should read pages until total_count is reached', async () => {
    const { client, get } = clientReturning([
      { orders: [{ id: 1 }, { id: 2 }], total_count: 3 },
      { orders: [{ id: 3 }], total_count: 3 },
    ]);

    const result = await listAllOffset(client, '/api/orders', { itemsKey: 'orders', pageSize: 2 });

    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: false });
    expect(callOptions(get, 1)).toEqual({ queryParams: { max: 2, offset: 2 } });
  });

  it('should stop on a short page when total_count is absent', async () => {
    const { client, get } = clientReturning([{ offers: [{ id: 1 }] }]);

    const result = await listAllOffset(client, '/api/offers', { itemsKey: 'offers', pageSize: 2 });

    expect(result.truncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should report truncated when maxPages stops the read', async () => {
    const { client } = clientReturning([
      { orders: [{ id: 1 }], total_count: 5 },
      { orders: [{ id: 2 }], total_count: 5 },
    ]);

    const result = await listAllOffset(client, '/api/orders', {
      itemsKey: 'orders',
      pageSize: 1,
      maxPages: 2,
    });

    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }], truncated: true });
  });

  it('should keep caller query parameters and cap the page size at 100', async () => {
    const { client, get } = clientReturning([{ orders: [], total_count: 0 }]);

    await listAllOffset(client, '/api/orders', {
      itemsKey: 'orders',
      pageSize: 500,
      queryParams: { order_state_codes: 'SHIPPING' },
    });

    expect(callOptions(get, 0)).toEqual({
      queryParams: { order_state_codes: 'SHIPPING', max: 100, offset: 0 },
    });
  });

  it('should raise when a page has no items array under the key', async () => {
    const { client } = clientReturning([{ data: [] }]);

    await expect(listAllOffset(client, '/api/orders', { itemsKey: 'orders' })).rejects.toBeInstanceOf(
      MiraklNetworkException,
    );
  });
});

describe('listAllSeek', () => {
  it('should follow next_page_token until it is null', async () => {
    const { client, get } = clientReturning([
      { data: [{ id: 'a' }], next_page_token: 'tok-2' },
      { data: [{ id: 'b' }], next_page_token: null },
    ]);

    const result = await listAllSeek(client, '/api/returns');

    expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b' }], truncated: false });
    expect(callOptions(get, 0)).toEqual({ queryParams: { limit: 100, page_token: undefined } });
    expect(callOptions(get, 1)).toEqual({ queryParams: { limit: 100, page_token: 'tok-2' } });
  });

  it('should report truncated when maxPages stops the read', async () => {
    const { client } = clientReturning([{ data: [{ id: 'a' }], next_page_token: 'tok-2' }]);

    const result = await listAllSeek(client, '/api/returns', { maxPages: 1 });

    expect(result.truncated).toBe(true);
  });

  it('should raise when a page has no data array', async () => {
    const { client } = clientReturning([{ returns: [] }]);

    await expect(listAllSeek(client, '/api/returns')).rejects.toBeInstanceOf(MiraklNetworkException);
  });
});
