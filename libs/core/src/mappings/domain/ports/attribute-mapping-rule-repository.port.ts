/**
 * Attribute Mapping Rule Repository Port
 *
 * Persistence contract for operator-authored attribute mapping rules (#1841).
 * Per-row upsert (create when `id` absent, update otherwise) + delete, scoped to
 * a destination connection.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { AttributeMappingRule } from '../entities/attribute-mapping-rule.entity';
import type { AttributeMappingRuleInput } from '../types/attribute-mapping-rule.types';

export interface AttributeMappingRuleRepositoryPort {
  /** All rules for a destination connection, ordered by `priority` ascending. */
  findByDestinationConnection(destinationConnectionId: string): Promise<AttributeMappingRule[]>;

  /** Create (no `id`) or update (with `id`) one rule. */
  upsertRule(
    destinationConnectionId: string,
    input: AttributeMappingRuleInput
  ): Promise<AttributeMappingRule>;

  /**
   * Delete a rule by surrogate id, scoped to its destination connection.
   * Throws `AttributeMappingRuleNotFoundException` when no rule with that id
   * exists under the given connection (so a rule cannot be deleted through a
   * different connection's path).
   */
  deleteRule(id: string, destinationConnectionId: string): Promise<void>;
}
