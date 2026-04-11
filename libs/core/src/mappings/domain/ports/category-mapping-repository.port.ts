/**
 * Category Mapping Repository Port
 *
 * Persistence contract for category mapping operations.
 * Unlike other mapping types (bulk replace), category mappings
 * support per-row upsert and delete for tree-based UI interaction.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import { CategoryMapping } from '../entities/category-mapping.entity';
import { CategoryMappingInput } from '../types/mapping.types';

export interface CategoryMappingRepositoryPort {
  findByConnectionId(connectionId: string): Promise<CategoryMapping[]>;

  findByPrestashopCategoryId(
    connectionId: string,
    prestashopCategoryId: string,
  ): Promise<CategoryMapping | null>;

  /**
   * Create or update a single category mapping.
   * Uses upsert on (connectionId, prestashopCategoryId) unique constraint.
   */
  upsertMapping(connectionId: string, input: CategoryMappingInput): Promise<CategoryMapping>;

  deleteMapping(connectionId: string, prestashopCategoryId: string): Promise<void>;
}
