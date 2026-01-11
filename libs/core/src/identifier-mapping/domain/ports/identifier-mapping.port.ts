/**
 * Identifier Mapping Port
 *
 * Defines the contract for identifier mapping operations. This port interface
 * specifies how external platform identifiers are mapped to internal OpenLinker
 * identifiers. Implemented by IdentifierMappingService to provide identifier
 * translation capabilities across all adapters.
 *
 * Adapters pass only `connectionId`; the service derives `platformType` from
 * the Connection internally to ensure consistency.
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
   * Service resolves platformType from Connection internally
   */
  getOrCreateInternalId(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string>;

  /**
   * Get internal identifier for an external entity
   * Returns null if mapping doesn't exist
   * Service resolves platformType from Connection internally
   */
  getInternalId(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
  ): Promise<string | null>;

  /**
   * Get external identifier(s) for an internal ID
   * Returns all platform-specific external IDs mapped to this internal ID
   */
  getExternalIds(entityType: EntityType, internalId: string): Promise<ExternalIdMapping[]>;

  /**
   * Create explicit mapping between external and internal identifiers
   * Used for manual mapping or when internal ID already exists
   * Service resolves platformType from Connection internally
   * @throws Error if mapping already exists
   */
  createMapping(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    internalId: string,
    context?: MappingContext,
  ): Promise<void>;

  /**
   * Batch get or create internal identifiers
   * Optimized for processing multiple entities at once
   * Service resolves platformType from Connection for each item internally
   * Returns map with composite key: `${externalId}:${connectionId}` -> internalId
   */
  batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>>;

  /**
   * Get or create exact mapping between external and internal identifiers
   * Checks both directions (by external ID and by internal ID) to handle conflicts
   * Returns the external ID if mapping exists or was created successfully
   * @throws Error if there's a conflict (e.g., external ID mapped to different internal ID)
   */
  getOrCreateExactMapping(
    entityType: EntityType,
    externalId: string,
    internalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string>;
}

