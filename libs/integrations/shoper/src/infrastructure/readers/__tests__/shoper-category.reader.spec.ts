import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperCategoryReader } from '../shoper-category.reader';

function clientWith(tree: unknown, pages: unknown[][]): ShoperHttpClient {
  const get = jest.fn().mockImplementation((path: string) => {
    if (path === '/categories-tree') {
      return Promise.resolve({ status: 200, data: tree });
    }
    return Promise.resolve({
      status: 200,
      data: { count: String(pages.flat().length), pages: pages.length, page: 1, list: pages[0] ?? [] },
    });
  });
  return { get } as unknown as ShoperHttpClient;
}

describe('ShoperCategoryReader', () => {
  it('should return the tree and the list', async () => {
    const reader = new ShoperCategoryReader(clientWith([{ id: 1, children: [] }], [[{ category_id: '1' }]]));

    const result = await reader.read();

    expect(result.tree).toEqual([{ id: 1, children: [] }]);
    expect(result.list).toHaveLength(1);
  });

  it('should refuse a tree that is not an array instead of reading it as no structure', async () => {
    const reader = new ShoperCategoryReader(clientWith({ oops: true }, [[]]));

    await expect(reader.read()).rejects.toBeInstanceOf(ShoperNetworkError);
  });

  it('should read the tree alone, with no request for the category list', async () => {
    const client = clientWith([{ id: 1, children: [] }], [[{ category_id: '1' }]]);
    const reader = new ShoperCategoryReader(client);

    await expect(reader.readTree()).resolves.toEqual([{ id: 1, children: [] }]);

    const paths = (client.get as jest.Mock).mock.calls.map(([path]) => path as string);
    expect(paths).toEqual(['/categories-tree']);
  });

  it('should refuse a tree read alone that is not an array', async () => {
    const reader = new ShoperCategoryReader(clientWith({ oops: true }, [[]]));

    await expect(reader.readTree()).rejects.toBeInstanceOf(ShoperNetworkError);
  });
});
