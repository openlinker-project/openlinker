/**
 * Unit tests for PrestashopCategoryPathResolver (#1096 F3)
 *
 * Verifies the resolver walks `id_parent` from a leaf category to the shop root,
 * excludes the Root/Home pseudo-categories, returns the path root→leaf, caches
 * per connection, and never breaks on a fetch failure (truncates the breadcrumb).
 */
import { PrestashopCategoryPathResolver } from '../prestashop-category-path.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopCategoryPathResolver', () => {
  let resolver: PrestashopCategoryPathResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  const localize = (field: unknown): string | undefined =>
    typeof field === 'string' ? field.trim() || undefined : undefined;

  // Tree: 2 (Home) → 5 (Home & Garden) → 12 (Mugs). Leaf = 12.
  const CATEGORIES: Record<string, { id: string; name: string; id_parent: string }> = {
    '5': { id: '5', name: 'Home & Garden', id_parent: '2' },
    '12': { id: '12', name: 'Mugs', id_parent: '5' },
  };

  beforeEach(() => {
    resolver = new PrestashopCategoryPathResolver();
    client = {
      getResource: jest.fn((_resource: string, id: string | number) => {
        const row = CATEGORIES[String(id)];
        if (!row) return Promise.reject(new Error('not found'));
        return Promise.resolve(row);
      }),
      listResources: jest.fn(),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  it('should build the path root→leaf, excluding Home/Root pseudo-categories', async () => {
    const path = await resolver.resolvePath('conn-1', '12', client, localize);

    expect(path).toEqual([
      { id: '5', name: 'Home & Garden' },
      { id: '12', name: 'Mugs' },
    ]);
  });

  it('should return an empty path for an excluded leaf (Home id 2)', async () => {
    const path = await resolver.resolvePath('conn-1', '2', client, localize);

    expect(path).toEqual([]);
    expect(client.getResource).not.toHaveBeenCalled();
  });

  it('should truncate the breadcrumb at a fetch failure rather than throw', async () => {
    // Leaf 12 resolves, its parent 5 fails to fetch.
    client.getResource = jest.fn((_resource: string, id: string | number) => {
      if (String(id) === '12') return Promise.resolve(CATEGORIES['12']);
      return Promise.reject(new Error('boom'));
    }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['getResource'];

    const path = await resolver.resolvePath('conn-1', '12', client, localize);

    // 12 resolves; the walk stops when parent 5 fails → only the leaf survives.
    expect(path).toEqual([{ id: '12', name: 'Mugs' }]);
  });

  it('should cache fetched rows per connection across repeated walks', async () => {
    await resolver.resolvePath('conn-1', '12', client, localize);
    await resolver.resolvePath('conn-1', '12', client, localize);

    // Two fetches (12 + 5) on the first walk; the second walk is fully cached.
    expect(client.getResource).toHaveBeenCalledTimes(2);
  });

  it('should fetch independently for different connections', async () => {
    await resolver.resolvePath('conn-1', '12', client, localize);
    await resolver.resolvePath('conn-2', '12', client, localize);

    expect(client.getResource).toHaveBeenCalledTimes(4);
  });
});
