/**
 * Shoper Category Reader (#3713)
 *
 * The one place the shop's category directory is read: the STRUCTURE from
 * `GET /categories-tree` (ids only) and the TEXT from the paged
 * `GET /categories`. Joining the two into neutral categories is
 * `joinShoperCategories`; this class only fetches.
 *
 * Shared by the ProductMaster adapter (which memoises the join for a sweep) and
 * the category provisioner (which reads fresh, because it changes what it
 * reads), so there is not a second tree reader to drift.
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import { ShoperNetworkError } from '../../domain/exceptions/shoper-network.error';
import type { ShoperCategory, ShoperCategoryTreeNode } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../http/shoper-pagination';

export interface ShoperCategoryRead {
  readonly list: ShoperCategory[];
  readonly tree: ShoperCategoryTreeNode[];
}

export class ShoperCategoryReader {
  constructor(private readonly client: ShoperHttpClient) {}

  async read(): Promise<ShoperCategoryRead> {
    const [tree, list] = await Promise.all([
      this.client.get<ShoperCategoryTreeNode[]>('/categories-tree'),
      this.fetchAll(),
    ]);
    // A legitimately empty tree is `[]`. Anything else that is not an array is
    // an unreadable answer, and reading it as "no structure" would return every
    // category as an unplaced root, dressed up as the real directory.
    if (!Array.isArray(tree.data)) {
      throw new ShoperNetworkError('Shoper returned an unreadable category tree');
    }
    return { list, tree: tree.data };
  }

  private async fetchAll(): Promise<ShoperCategory[]> {
    const categories: ShoperCategory[] = [];
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperCategory>(this.client, '/categories', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { order: 'category_id ASC' },
      });
      categories.push(...result.items);
      if (page >= result.pages) {
        return categories;
      }
    }
  }
}
