/**
 * Identifier Mapping Port
 *
 * Defines the contract for identifier mapping operations. This port interface
 * specifies how external platform identifiers are mapped to internal OpenLinker
 * identifiers. Implemented by IdentifierMappingService to provide identifier
 * translation capabilities across all adapters.
 *
 * @module libs/core/src/identifier-mapping/domain/ports
 * @see {@link IdentifierMappingService} for the implementation
 */
import {
  EntityType,
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '../types/identifier-mapping.types';

export interface IdentifierMappingPort {
  /**
   * Get or create internal identifier for an external entity
   * If mapping exists, returns existing internal ID
   * If not, generates new internal ID and creates mapping
   */
  getOrCreateInternalId(
    entityType: EntityType,
    externalId: string,
    platformId: string,
    context?: MappingContext,
  ): Promise<string>;

  /**
   * Get internal identifier for an external entity
   * Returns null if mapping doesn't exist
   */
  getInternalId(
    entityType: EntityType,
    externalId: string,
    platformId: string,
  ): Promise<string | null>;

  /**
   * Get external identifier(s) for an internal ID
   * Returns all platform-specific external IDs mapped to this internal ID
   */
  getExternalIds(entityType: EntityType, internalId: string): Promise<ExternalIdMapping[]>;

  /**
   * Create explicit mapping between external and internal identifiers
   * Used for manual mapping or when internal ID already exists
   */
  createMapping(
    entityType: EntityType,
    externalId: string,
    platformId: string,
    internalId: string,
  ): Promise<void>;

  /**
   * Batch get or create internal identifiers
   * Optimized for processing multiple entities at once
   */
  batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>>; // externalId -> internalId
}

