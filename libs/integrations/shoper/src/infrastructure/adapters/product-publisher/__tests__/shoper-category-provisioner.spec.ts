import type { Connection } from '@openlinker/core/identifier-mapping';
import { ProductPublishRejectedException } from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT } from '../../../__tests__/shoper-test-data';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

interface FakeCategory {
  id: number;
  parent: number;
  name: string;
}

interface CategoryBody {
  parent_id: number;
  translations: Record<string, { name: string; active: number }>;
}

interface Harness {
  adapter: ShoperProductPublisherAdapter;
  post: jest.Mock;
  get: jest.Mock;
  shop: FakeCategory[];
  raceNextCreate: (parent: number, name: string) => void;
}

/** The body of the n-th create the adapter issued. */
function createBody(post: jest.Mock, n = 0): CategoryBody {
  return (post.mock.calls[n] as [string, CategoryBody])[1];
}

/**
 * A tiny stateful shop: the tree, the list and the create all read one array, so
 * what the adapter creates is what it reads back - which is the whole question
 * for an ensure-exists operation.
 */
function setup(initial: FakeCategory[] = [], language = 'pl_PL'): Harness {
  const shop: FakeCategory[] = [...initial];
  let nextId = Math.max(100, ...shop.map((c) => c.id + 1));
  /** Rows injected into the shop right after the adapter's own create, simulating a racing publish. */
  let racers: FakeCategory[] = [];

  const treeOf = (parent: number): { id: number; children: unknown[] }[] =>
    shop.filter((c) => c.parent === parent).map((c) => ({ id: c.id, children: treeOf(c.id) }));

  const get = jest.fn().mockImplementation((path: string) => {
    if (path === '/categories-tree') {
      return Promise.resolve({ status: 200, data: treeOf(0) });
    }
    return Promise.resolve({
      status: 200,
      data: {
        count: String(shop.length),
        pages: 1,
        page: 1,
        list: shop.map((c) => ({
          category_id: String(c.id),
          translations: { [language]: { name: c.name, active: '1' } },
        })),
      },
    });
  });
  const post = jest.fn().mockImplementation((_path: string, body: CategoryBody) => {
    const created = {
      id: nextId++,
      parent: body.parent_id,
      name: Object.values(body.translations)[0]?.name ?? '',
    };
    shop.push(created);
    shop.push(...racers.map((r) => ({ ...r, id: nextId++ })));
    racers = [];
    return Promise.resolve({ status: 200, data: created.id });
  });

  const adapter = new ShoperProductPublisherAdapter(
    { get, post, put: jest.fn() } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve({ ...MAP_CONTEXT, language }) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
  return {
    adapter,
    post,
    get,
    shop,
    /** The next create is raced by another publish creating the same node (given parent/name). */
    raceNextCreate: (parent: number, name: string): void => {
      racers = [{ id: 0, parent, name }];
    },
  };
}

const path = (...names: string[]): { sourceCategoryId: string; name: string }[] =>
  names.map((name, i) => ({ sourceCategoryId: `src-${i}`, name }));

describe('ShoperProductPublisherAdapter.provisionCategory', () => {
  it('should create a missing root and return its id', async () => {
    const { adapter, post } = setup();

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia') });

    expect(post).toHaveBeenCalledWith('/categories', {
      parent_id: 0,
      translations: { pl_PL: { name: 'Kuchnia', active: 1 } },
    });
    expect(result).toEqual({ destinationCategoryId: '100', createdPath: ['100'] });
  });

  it('should create the missing nodes of a path under each other, root first', async () => {
    const { adapter, post } = setup();

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Zestawy') });

    expect(post.mock.calls.map((_c, n) => createBody(post, n).parent_id)).toEqual([0, 100]);
    expect(result).toEqual({ destinationCategoryId: '101', createdPath: ['100', '101'] });
  });

  it('should reuse an existing category and create nothing, so provisioning twice never duplicates', async () => {
    const { adapter, post } = setup([
      { id: 45, parent: 0, name: 'Kuchnia' },
      { id: 38, parent: 45, name: 'Zestawy' },
    ]);

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Zestawy') });

    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({ destinationCategoryId: '38' });
  });

  it('should create only the missing tail of a partly existing path', async () => {
    const { adapter, post } = setup([{ id: 45, parent: 0, name: 'Kuchnia' }]);

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Garnki') });

    expect(post).toHaveBeenCalledTimes(1);
    expect(createBody(post)).toMatchObject({ parent_id: 45 });
    expect(result.createdPath).toEqual(['100']);
  });

  it('should not mistake a same-named category under a different parent for the wanted one', async () => {
    const { adapter, post } = setup([
      { id: 45, parent: 0, name: 'Kuchnia' },
      { id: 50, parent: 0, name: 'Salon' },
      { id: 51, parent: 50, name: 'Zestawy' },
    ]);

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Zestawy') });

    expect(post).toHaveBeenCalledTimes(1);
    expect(createBody(post)).toMatchObject({ parent_id: 45 });
    expect(result.destinationCategoryId).toBe('100');
  });

  it('should match the name after trimming, and create it trimmed', async () => {
    const { adapter, post } = setup();

    await adapter.provisionCategory({ connectionId: 'c', path: [{ sourceCategoryId: 's', name: '  Kuchnia ' }] });

    expect(createBody(post)).toMatchObject({
      translations: { pl_PL: { name: 'Kuchnia' } },
    });
  });

  it('should write the name under the shop default language', async () => {
    const { adapter, post } = setup([], 'en_US');

    await adapter.provisionCategory({ connectionId: 'c', path: path('Kitchen') });

    expect(Object.keys(createBody(post).translations)).toEqual(['en_US']);
  });

  it('should settle on the lowest id when a racing publish created the same node, and not claim it as created', async () => {
    const { adapter, raceNextCreate } = setup([{ id: 45, parent: 0, name: 'Kuchnia' }]);
    // The racer's twin lands right after our create, so it gets the HIGHER id.
    raceNextCreate(45, 'Garnki');

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Garnki') });

    // Ours (100) is the lowest of {100, 101}: both publishes converge on it.
    expect(result.destinationCategoryId).toBe('100');
    expect(result.createdPath).toEqual(['100']);
  });

  it('should adopt the lower-id twin and report nothing as created when a racing publish got there first', async () => {
    const { adapter, shop, post } = setup([{ id: 45, parent: 0, name: 'Kuchnia' }]);
    post.mockImplementationOnce((_path: string, body: CategoryBody) => {
      // The racer's node appears with a lower id than the one this call is given.
      shop.push({ id: 90, parent: body.parent_id, name: 'Garnki' });
      shop.push({ id: 120, parent: body.parent_id, name: 'Garnki' });
      return Promise.resolve({ status: 200, data: 120 });
    });

    const result = await adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', 'Garnki') });

    expect(result).toEqual({ destinationCategoryId: '90' });
  });

  describe('refusals and failures', () => {
    it('should refuse an empty path without calling the shop', async () => {
      const { adapter, get, post } = setup();

      await expect(adapter.provisionCategory({ connectionId: 'c', path: [] })).rejects.toBeInstanceOf(
        ProductPublishRejectedException,
      );
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });

    it('should refuse a node with no name, before creating anything', async () => {
      const { adapter, post } = setup();

      await expect(adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia', '  ') })).rejects.toBeInstanceOf(
        ProductPublishRejectedException,
      );
      expect(post).not.toHaveBeenCalled();
    });

    it('should let a Shoper error propagate untouched so the job retries', async () => {
      const { adapter, post } = setup();
      const failure = new ShoperApiError(503);
      post.mockRejectedValue(failure);

      await expect(adapter.provisionCategory({ connectionId: 'c', path: path('Kuchnia') })).rejects.toBe(failure);
    });

    it('should refuse, not retry as a network fault, when Shoper answers a create without an id', async () => {
      const { adapter, post } = setup();
      post.mockResolvedValue({ status: 200, data: { ok: true } });

      const error: unknown = await adapter
        .provisionCategory({ connectionId: 'c', path: path('Kuchnia') })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProductPublishRejectedException);
      expect((error as ProductPublishRejectedException).errors[0]?.code).toBe(
        'shoper_category_create_answer_unreadable',
      );
    });
  });
});
