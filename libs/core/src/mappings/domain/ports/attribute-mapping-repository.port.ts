/**
 * Attribute Mapping Repository Port
 *
 * Persistence contract for attribute-mapping operations (#1038, ADR-023 §4).
 * Per-row upsert + delete, keyed on
 * (sourceConnectionId, destinationConnectionId, sourceAttributeKey,
 * destinationCategoryId). The aggregate includes its value translations.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { AttributeMapping } from '../entities/attribute-mapping.entity';
import type { AttributeMappingInput } from '../types/mapping.types';

export interface AttributeMappingRepositoryPort {
  /** All attribute mappings (with their value translations) for a destination connection. */
  findByDestinationConnection(destinationConnectionId: string): Promise<AttributeMapping[]>;

  /**
   * All attribute mappings authored under a given owner-taxonomy provenance
   * (e.g. `'allegro'`), across destination connections (#1045). Used for
   * borrowed-taxonomy reuse: a `borrows` destination (ERLI) reuses the owner's
   * attribute mappings. The projection service filters the result by source
   * connection + category in memory.
   */
  findByProvenance(destinationTaxonomyProvenance: string): Promise<AttributeMapping[]>;

  /**
   * Create or update one attribute mapping (and replace its value set), keyed on
   * (sourceConnectionId, destinationConnectionId, sourceAttributeKey,
   * destinationCategoryId — `null` ⇒ the connection-wide default row).
   */
  upsertMapping(
    destinationConnectionId: string,
    input: AttributeMappingInput
  ): Promise<AttributeMapping>;

  /** Delete a mapping by surrogate id (value rows cascade). */
  deleteMapping(id: string): Promise<void>;
}
