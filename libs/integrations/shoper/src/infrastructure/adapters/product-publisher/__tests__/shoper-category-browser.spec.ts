import type { Connection } from '@openlinker/core/identifier-mapping';
import { isShopCategoryBrowser } from '@openlinker/core/listings';

import type { ShoperCategory, ShoperCategoryTreeNode } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT, envelope } from '../../../__tests__/shoper-test-data';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

/** A category row in the shop's default language (`pl_PL`). */
function row(id: number, name: string, language = 'pl_PL'): ShoperCategory {
  return { category_id: String(id), translations: { [language]: { name, active: '1' } } };
}

function node(id: number, children: ShoperCategoryTreeNode[] = []): ShoperCategoryTreeNode {
  return { id, children };
}

interface Harness {
  adapter: ShoperProductPublisherAdapter;
  get: jest.Mock;
  post: jest.Mock;
}

/**
 * `pages` splits `list` into pages of 50 (Shoper's ceiling), so a directory
 * larger than one page is served the way the shop serves it.
 */
function setup(tree: ShoperCategoryTreeNode[], list: ShoperCategory[]): Harness {
  const pages = Math.max(1, Math.ceil(list.length / 50));
  const get = jest.fn().mockImplementation((path: string, query?: { page?: number }) => {
    if (path === '/categories-tree') {
      return Promise.resolve({ status: 200, data: tree });
    }
    const page = query?.page ?? 1;
    return Promise.resolve({
      status: 200,
      data: envelope(list.slice((page - 1) * 50, page * 50), { count: list.length, pages, page }),
    });
  });
  const post = jest.fn().mockResolvedValue({ status: 200, data: 999 });
  const adapter = new ShoperProductPublisherAdapter(
    { get, post, put: jest.fn(), delete: jest.fn() } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve(MAP_CONTEXT) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
  return { adapter, get, post };
}

const TREE = [node(1, [node(3), node(4, [node(5)])]), node(2)];
const LIST = [row(1, 'Zabawki'), row(2, 'Akcesoria'), row(3, 'Pluszaki'), row(4, 'Klocki'), row(5, 'Duplo')];

describe('ShoperProductPublisherAdapter.browseCategories', () => {
  it('should satisfy the ShopCategoryBrowser guard', () => {
    expect(isShopCategoryBrowser(setup(TREE, LIST).adapter)).toBe(true);
  });

  it('should list root categories, sorted by name, with a null parent when no parent is given', async () => {
    const { adapter } = setup(TREE, LIST);

    await expect(adapter.browseCategories()).resolves.toEqual([
      { id: '2', name: 'Akcesoria', parentId: null },
      { id: '1', name: 'Zabawki', parentId: null },
    ]);
  });

  it('should list only the direct children of a parent', async () => {
    const { adapter } = setup(TREE, LIST);

    await expect(adapter.browseCategories('1')).resolves.toEqual([
      { id: '4', name: 'Klocki', parentId: '1' },
      { id: '3', name: 'Pluszaki', parentId: '1' },
    ]);
    await expect(adapter.browseCategories('4')).resolves.toEqual([
      { id: '5', name: 'Duplo', parentId: '4' },
    ]);
  });

  it('should list nothing under a leaf or an unknown parent rather than repeating the root', async () => {
    const { adapter } = setup(TREE, LIST);

    await expect(adapter.browseCategories('5')).resolves.toEqual([]);
    await expect(adapter.browseCategories('404')).resolves.toEqual([]);
  });

  it('should read the directory once per adapter, however many parents the sync walks', async () => {
    const { adapter, get } = setup(TREE, LIST);

    await adapter.browseCategories();
    await adapter.browseCategories('1');
    await adapter.browseCategories('4');
    await Promise.all([adapter.browseCategories('2'), adapter.browseCategories('3')]);

    const treeReads = get.mock.calls.filter(([path]) => path === '/categories-tree');
    const listReads = get.mock.calls.filter(([path]) => path === '/categories');
    expect(treeReads).toHaveLength(1);
    expect(listReads).toHaveLength(1);
  });

  it('should page past Shoper’s 50-row ceiling so a large directory is listed whole', async () => {
    const children = Array.from({ length: 120 }, (_, i) => node(100 + i));
    const list = [
      row(1, 'Root'),
      ...children.map((child) => row(child.id, `Kategoria ${String(child.id).padStart(4, '0')}`)),
    ];
    const { adapter, get } = setup([node(1, children)], list);

    const result = await adapter.browseCategories('1');

    expect(result).toHaveLength(120);
    expect(get.mock.calls.filter(([path]) => path === '/categories')).toHaveLength(3);
  });

  it('should leave out a category the tree does not place, since its parent is unknown', async () => {
    const { adapter } = setup(TREE, [...LIST, row(9, 'Bez miejsca')]);

    const roots = await adapter.browseCategories();

    expect(roots.map((category) => category.id)).not.toContain('9');
  });

  it('should name a category from another language when the default language has no name for it', async () => {
    const { adapter } = setup([node(7)], [row(7, 'Toys', 'en_GB')]);

    await expect(adapter.browseCategories()).resolves.toEqual([
      { id: '7', name: 'Toys', parentId: null },
    ]);
  });

  it('should retry the read after a failure instead of replaying it', async () => {
    const { adapter, get } = setup(TREE, LIST);
    get.mockRejectedValueOnce(new Error('network down'));

    await expect(adapter.browseCategories()).rejects.toThrow('network down');
    await expect(adapter.browseCategories()).resolves.toHaveLength(2);
  });

  it('should read the directory again after provisioning a category, so the new node is browsable', async () => {
    const { adapter, get } = setup(TREE, LIST);
    await adapter.browseCategories();
    const readsBefore = get.mock.calls.filter(([path]) => path === '/categories-tree').length;

    await adapter.provisionCategory({
      connectionId: 'conn-1',
      path: [{ sourceCategoryId: 'src-1', name: 'Nowa' }],
    });
    await adapter.browseCategories();

    const readsAfter = get.mock.calls.filter(([path]) => path === '/categories-tree').length;
    // The provisioner reads twice itself (before and after the create), then the browse reads once more.
    expect(readsAfter - readsBefore).toBe(3);
  });
});
