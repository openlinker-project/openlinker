/**
 * Categories Cache Service Interface
 *
 * Contract for fetching and caching marketplace categories per connection.
 *
 * @module apps/api/src/categories
 */

import type { OfferCategory, CategoryPathSegment } from '@openlinker/core/listings';

export interface PrestashopCategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  active: boolean;
}

export interface ICategoriesCacheService {
  /**
   * Get Allegro categories for a connection, using DB cache with 24h TTL.
   * Fetches from the Allegro API and stores in cache when stale or missing.
   *
   * @param connectionId - Connection UUID
   * @param parentId - Optional parent category ID (omit for root categories)
   */
  getAllegroCategories(connectionId: string, parentId?: string): Promise<OfferCategory[]>;

  /**
   * Resolve an Allegro category id to its root-to-leaf breadcrumb via the
   * connection's `CategoryPathReader` adapter. Returns an empty array when the
   * adapter does not implement the capability, or when the category cannot be
   * resolved (`CategoryNotFoundException`) - graceful in both cases, since the
   * caller falls back to rendering the raw id.
   *
   * @param connectionId - Connection UUID
   * @param categoryId - Marketplace (Allegro) category id
   */
  getAllegroCategoryPath(connectionId: string, categoryId: string): Promise<CategoryPathSegment[]>;

  /**
   * Get PrestaShop categories for a connection.
   * Fetches live from the PrestaShop WebService API (no caching — small dataset).
   *
   * @param connectionId - Connection UUID
   */
  getPrestashopCategories(connectionId: string): Promise<PrestashopCategoryDto[]>;

  /**
   * Invalidate all cached Allegro categories for a connection.
   */
  invalidateCache(connectionId: string): Promise<void>;
}
