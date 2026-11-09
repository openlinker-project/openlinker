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
import type {
  CategoryMappingInput,
  CategoryMappingReassignResult,
} from '../types/mapping.types';

export interface CategoryMappingRepositoryPort {
  /**
   * Mappings authored for a destination connection. With `sourceConnectionId`,
   * only the rows that apply to that source: its own rows plus the
   * source-agnostic (`NULL`) historical ones. A source category carrying both
   * is returned once, preferring the source's own row (#3993).
   */
  findByDestinationConnection(
    destinationConnectionId: string,
    sourceConnectionId?: string
  ): Promise<CategoryMapping[]>;

  /**
   * Resolve the mapping for a (destination connection, source category) pair.
   *
   * The neutralised schema (#1036) permits more than one row per
   * (destination, source category) once multiple source stores map the same
   * store-local `sourceCategoryId` — so implementations MUST order
   * deterministically and surface a warning when >1 row matches, rather than
   * silently picking one.
   *
   * With `sourceConnectionId` (#3993), a row authored for a DIFFERENT source
   * store never applies: the source's own row wins, then a source-agnostic
   * (`NULL`) historical row. Two stores share category ids routinely
   * (PrestaShop `3` and WooCommerce `3`), so ignoring the source would place one
   * store's products by the other store's mapping.
   */
  findBySourceCategory(
    destinationConnectionId: string,
    sourceCategoryId: string,
    sourceConnectionId?: string | null
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

  /**
   * Delete the mapping for a source category. With `sourceConnectionId`, only
   * that source's own row is removed. The source-agnostic (`NULL`) row is left
   * alone: it is the fallback every other source resolves through, so
   * clearing one master's mapping must not take it from the rest.
   */
  deleteMapping(
    destinationConnectionId: string,
    sourceCategoryId: string,
    sourceConnectionId?: string
  ): Promise<void>;

  /**
   * Move every row keyed by `fromDestinationConnectionId` to
   * `toDestinationConnectionId`, stamping `sourceConnectionId` with the old
   * destination when it was `NULL` (#3993: rows the Category Mappings page
   * once wrote under the master's own id). A source category already mapped
   * at the target for that source keeps the target's row, and the moved row
   * is dropped. Runs in one transaction. The same id on both sides moves
   * nothing (every row would otherwise clash with itself and be dropped).
   */
  reassignDestination(
    fromDestinationConnectionId: string,
    toDestinationConnectionId: string
  ): Promise<CategoryMappingReassignResult>;
}
