/**
 * Categories Cache Service Interface
 *
 * Contract for fetching and caching marketplace categories per connection.
 *
 * @module apps/api/src/categories
 */

import type { OfferCategory } from '@openlinker/core/listings';

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
