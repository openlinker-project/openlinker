/**
 * Identifier Mapping Domain Entity
 *
 * Represents a mapping between an external platform identifier and an internal
 * OpenLinker identifier. This is a core domain entity used across all adapters
 * to maintain consistent identity across platforms. Ensures all entities have
 * unique internal identifiers from a single unified seed.
 *
 * @module libs/core/src/identifier-mapping/domain/entities
 */
import { EntityType, MappingContext } from '../types/identifier-mapping.types';

export class IdentifierMapping {
  constructor(
    public readonly id: string,
    public readonly entityType: EntityType,
    public readonly internalId: string,
    public readonly externalId: string,
    public readonly platformId: string,
    public readonly context: MappingContext | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}

