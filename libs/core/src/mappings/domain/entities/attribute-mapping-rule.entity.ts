/**
 * Attribute Mapping Rule Domain Entity
 *
 * An operator-authored, deterministic rule (#1841) that fills a destination
 * parameter/attribute by name. Scoped by (optional) source connection,
 * destination category, manufacturer, and product-name phrase; ordered by
 * `priority`. Pure domain entity, no framework deps. `kind` is a pure derivation
 * of `config.kind` (ADR-011 read-only behaviour allowance).
 *
 * @module libs/core/src/mappings/domain/entities
 */

import type {
  AttributeMappingRuleConfig,
  AttributeMappingRuleKind,
} from '../types/attribute-mapping-rule.types';

export class AttributeMappingRule {
  constructor(
    public readonly id: string,
    public readonly destinationConnectionId: string,
    public readonly destinationParameterName: string,
    public readonly config: AttributeMappingRuleConfig,
    public readonly priority: number,
    public readonly sourceConnectionId: string | null,
    public readonly destinationCategoryId: string | null,
    public readonly manufacturerMatch: string | null,
    public readonly phraseMatch: string | null
  ) {}

  /** Pure derivation of the rule kind from its discriminated config. */
  get kind(): AttributeMappingRuleKind {
    return this.config.kind;
  }
}
