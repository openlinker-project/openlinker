/**
 * PrestaShop Category-Path Resolver (#1096 F3)
 *
 * Resolves a product's full category PATH (root→leaf) into `{ id, name }[]` so a
 * borrows destination (Erli) can emit a `source:"shop"` breadcrumb instead of a
 * bare leaf id. PrestaShop has no path endpoint — each `GET /categories/{id}`
 * returns the category's own `name` + `id_parent`, so the path is reconstructed
 * by walking the parent chain from the product's `id_category_default` until the
 * shop root.
 *
 * The Root (id 1) and Home (id 2) pseudo-categories are EXCLUDED — they carry no
 * buyer-facing meaning on the marketplace breadcrumb. The walk also stops at
 * `id_parent` 0 and guards against cycles via a visited-set + depth cap.
 *
 * Per-category rows are cached **per connection per TTL** (the tree is small and
 * near-static); like the option/feature resolvers this must be held on the
 * process-singleton factory for the cache to survive across the per-product
 * adapter instances the master sync creates.
 *
 * Localization reuses the product mapper's `localizeField`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { LocalizeFn } from '../../domain/types/prestashop-product-option.types';

/** A resolved category-path node (#1096 F3). */
export interface CategoryPathNode {
  id: string;
  name: string;
}

/** A single fetched category row (id, name, parent). */
interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
}

interface CacheEntry {
  rowById: Map<string, CategoryRow | null>;
  timestamp: number;
}

/** Cache TTL (24h) — mirrors the sibling resolvers. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * PrestaShop pseudo-category ids excluded from the buyer-facing breadcrumb:
 * 0 (no parent sentinel), 1 (Root), 2 (Home). Walking stops once a parent id is
 * in this set.
 */
const EXCLUDED_CATEGORY_IDS = new Set(['0', '1', '2']);

/** Depth cap — defends against a malformed tree producing an unbounded walk. */
const MAX_PATH_DEPTH = 32;

export class PrestashopCategoryPathResolver {
  private readonly logger = new Logger(PrestashopCategoryPathResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve the full category path (root→leaf, `{ id, name }`) for a leaf
   * category id. Returns `[]` when the leaf is missing / excluded / unresolvable
   * so the caller can fall back to the bare-id categories.
   *
   * @param connectionId - Cache key for the per-category row cache
   * @param leafCategoryId - The product's `id_category_default`
   * @param client - PrestaShop WebService client for this connection
   * @param localize - Localized-field reader (the product mapper's `localizeField`)
   * @param langId - Preferred language ID (default: 1)
   */
  async resolvePath(
    connectionId: string,
    leafCategoryId: string,
    client: IPrestashopWebserviceClient,
    localize: LocalizeFn,
    langId = 1
  ): Promise<CategoryPathNode[]> {
    const rowById = this.getConnectionCache(connectionId);

    const reversed: CategoryPathNode[] = [];
    const visited = new Set<string>();
    let currentId: string | null = leafCategoryId;
    let depth = 0;

    while (
      currentId !== null &&
      !EXCLUDED_CATEGORY_IDS.has(currentId) &&
      !visited.has(currentId) &&
      depth < MAX_PATH_DEPTH
    ) {
      visited.add(currentId);
      depth += 1;
      const row = await this.fetchCategoryRow(currentId, rowById, client, localize, langId);
      if (row === null) {
        break;
      }
      reversed.push({ id: row.id, name: row.name });
      currentId = row.parentId;
    }

    // Walked leaf→root; the breadcrumb is root→leaf.
    return reversed.reverse();
  }

  private getConnectionCache(connectionId: string): Map<string, CategoryRow | null> {
    const cached = this.cache.get(connectionId);
    if (cached !== undefined && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.rowById;
    }
    const rowById = new Map<string, CategoryRow | null>();
    this.cache.set(connectionId, { rowById, timestamp: Date.now() });
    return rowById;
  }

  /**
   * Fetch one category row (cached). A fetch failure / unresolvable name caches
   * `null` so a repeated walk doesn't re-hit the broken id within the TTL.
   */
  private async fetchCategoryRow(
    id: string,
    rowById: Map<string, CategoryRow | null>,
    client: IPrestashopWebserviceClient,
    localize: LocalizeFn,
    langId: number
  ): Promise<CategoryRow | null> {
    if (rowById.has(id)) {
      return rowById.get(id) ?? null;
    }
    try {
      const raw = await client.getResource<Record<string, unknown>>('categories', id);
      const name = localize(raw['name'], langId);
      if (!name) {
        rowById.set(id, null);
        return null;
      }
      const parentRaw = raw['id_parent'];
      const parentId =
        parentRaw === null || parentRaw === undefined ? null : String(parentRaw).trim() || null;
      const row: CategoryRow = { id, name, parentId };
      rowById.set(id, row);
      return row;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch PrestaShop category ${id}; truncating breadcrumb here: ${
          (error as Error).message
        }`
      );
      rowById.set(id, null);
      return null;
    }
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId) {
      this.cache.delete(connectionId);
    } else {
      this.cache.clear();
    }
  }
}
