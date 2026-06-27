/**
 * Category Mapping Repository Port
 *
 * Persistence contract for category mapping operations.
 * Unlike other mapping types (bulk replace), category mappings
 * support per-row upsert and delete for tree-based UI interaction.
 *
 * Neutralised in #1036 (ADR-023 §2): keyed by destination connection +
 * source category. `sourceConnectionId` scoping is recorded but not yet part of
 * the lookup key (record-only) — see `findBySourceCategory`.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { CategoryMapping } from '../entities/category-mapping.entity';
import type { CategoryMappingInput } from '../types/mapping.types';

export interface CategoryMappingRepositoryPort {
  findByDestinationConnection(destinationConnectionId: string): Promise<CategoryMapping[]>;

  /**
   * Resolve the mapping for a (destination connection, source category) pair.
   *
   * The neutralised schema (#1036) permits more than one row per
   * (destination, source category) once multiple source stores map the same
   * store-local `sourceCategoryId` — so implementations MUST order
   * deterministically and surface a warning when >1 row matches, rather than
   * silently picking one. Full source-connection-scoped lookup is a follow-up.
   */
  findBySourceCategory(
    destinationConnectionId: string,
    sourceCategoryId: string
  ): Promise<CategoryMapping | null>;

  /**
   * Resolve a mapping for a source category against any destination connection
   * that authored a row under the given owner taxonomy provenance (#1045, ADR-023
   * §40/§83) — the "borrowed taxonomy reuse" lookup. A `borrows` destination
   * (ERLI) has no rows of its own; this reuses an owner-authored row
   * (`destination_taxonomy_provenance = :provenance`, e.g. `'allegro'`) with zero
   * re-authoring.
   *
   * When `sourceConnectionId` is given, matches rows for that source store OR the
   * source-agnostic (`NULL`) historical rows — bounding multi-owner-connection
   * ambiguity. Like `findBySourceCategory`, MUST order deterministically and warn
   * when >1 row matches rather than silently picking one.
   */
  findBySourceCategoryByProvenance(
    destinationTaxonomyProvenance: string,
    sourceCategoryId: string,
    sourceConnectionId?: string | null
  ): Promise<CategoryMapping | null>;

  /**
   * Create or update a single category mapping, keyed on
   * (destinationConnectionId, sourceConnectionId, sourceCategoryId).
   */
  upsertMapping(
    destinationConnectionId: string,
    input: CategoryMappingInput
  ): Promise<CategoryMapping>;

  deleteMapping(destinationConnectionId: string, sourceCategoryId: string): Promise<void>;
}
