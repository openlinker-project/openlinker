import { buildStock, envelope } from '../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../shoper-http-client';
import { fetchShoperStocks } from '../shoper-stocks';

function clientServing(pages: unknown[][]): { client: ShoperHttpClient; get: jest.Mock } {
  const get = jest.fn((_path: string, query: { page: number }) =>
    Promise.resolve({
      status: 200,
      data: envelope(pages[query.page - 1] ?? [], { pages: pages.length, page: query.page }),
    }),
  );
  return { client: { get } as unknown as ShoperHttpClient, get };
}

describe('fetchShoperStocks', () => {
  it('should exhaust every page, filtered by product and in stock_id order', async () => {
    const { client, get } = clientServing([
      [buildStock({ stock_id: '1' })],
      [buildStock({ stock_id: '2' })],
    ]);

    const stocks = await fetchShoperStocks(client, '93', () => undefined);

    expect(stocks.map((s) => s.stock_id)).toEqual(['1', '2']);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(
      '/product-stocks',
      expect.objectContaining({ 'filters[product_id]': '93', order: 'stock_id ASC', limit: 50 }),
    );
  });

  it('should drop rows of another product and report how many, so an ignored filter never leaks', async () => {
    const { client } = clientServing([
      [buildStock({ stock_id: '1' }), buildStock({ stock_id: '2', product_id: '7' })],
      [buildStock({ stock_id: '3', product_id: '8' })],
    ]);
    const onForeignRows = jest.fn();

    const stocks = await fetchShoperStocks(client, '93', onForeignRows);

    expect(stocks.map((s) => s.stock_id)).toEqual(['1']);
    expect(onForeignRows.mock.calls).toEqual([[1], [1]]);
  });

  it('should not report foreign rows when every row is the product’s own', async () => {
    const { client } = clientServing([[buildStock()]]);
    const onForeignRows = jest.fn();

    await fetchShoperStocks(client, '93', onForeignRows);

    expect(onForeignRows).not.toHaveBeenCalled();
  });
});
