/**
 * Identifier Mapping Ports
 *
 * Split into a read-only Query port and a write Command port, with a combined
 * IdentifierMappingPort (the backwards-compatible union) for consumers that
 * need both sides. New read-only consumers should depend on the narrower
 * IdentifierMappingQueryPort to keep mocks small.
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

/**
 * Read-only view of the identifier mapping store.
 *
 * Prefer this over the combined {@link IdentifierMappingPort} when a consumer
 * only reads mappings.
 */
export interface IdentifierMappingQueryPort {
  /**
   * Get internal identifier for an external entity
   * Returns null if mapping doesn't exist
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
   * List all external IDs for a given entity type and connection.
   *
   * Used by periodic sync to enumerate all known entities for a connection
   * without calling the external platform API.
   */
  listExternalIdsByConnection(
    entityType: EntityType,
    connectionId: string,
  ): Promise<string[]>;
}

/**
 * Write-side operations on the identifier mapping store.
 */
export interface IdentifierMappingCommandPort {
  /**
   * Get or create internal identifier for an external entity.
   * If mapping exists, returns existing internal ID; otherwise generates a new
   * internal ID and creates the mapping.
   */
  getOrCreateInternalId(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string>;

  /**
   * Create explicit mapping between external and internal identifiers.
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
   * Batch get or create internal identifiers.
   * Returns map with composite key `${externalId}:${connectionId}` -> internalId.
   */
  batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>>;

  /**
   * Get or create exact mapping between external and internal identifiers.
   * Checks both directions (by external ID and by internal ID) to handle conflicts.
   * @throws Error on conflict (external ID mapped to different internal ID)
   */
  getOrCreateExactMapping(
    entityType: EntityType,
    externalId: string,
    internalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string>;

  /**
   * Delete mapping by external key (idempotent).
   */
  deleteMapping(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
  ): Promise<void>;
}

/**
 * Combined identifier mapping port — union of query and command operations.
 *
 * Kept for backwards compatibility. Prefer {@link IdentifierMappingQueryPort}
 * or {@link IdentifierMappingCommandPort} in new code.
 */
export type IdentifierMappingPort = IdentifierMappingQueryPort & IdentifierMappingCommandPort;
