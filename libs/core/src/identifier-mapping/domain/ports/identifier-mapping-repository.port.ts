/**
 * Identifier Mapping Repository Port
 *
 * Defines the contract for identifier mapping persistence operations.
 * This port interface specifies the persistence methods needed by application
 * services, without exposing infrastructure details (TypeORM, database, etc.).
 *
 * Implemented by IdentifierMappingRepository in the infrastructure layer
 * to provide data access capabilities while maintaining proper dependency
 * direction (application → domain, not application → infrastructure).
 *
 * @module libs/core/src/identifier-mapping/domain/ports
 * @see {@link IdentifierMappingRepository} for the implementation
 */
import { IdentifierMapping } from '../entities/identifier-mapping.entity';

export interface IdentifierMappingRepositoryPort {
  /**
   * Find mapping by external key (entityType, platformType, connectionId, externalId)
   * Used by service after resolving platformType from Connection
   */
  findByExternalKey(
    entityType: string,
    platformType: string,
    connectionId: string,
    externalId: string,
  ): Promise<IdentifierMapping | null>;

  /**
   * Find all mappings for a given internal ID (reverse lookup)
   * Returns all external IDs mapped to this internal ID
   */
  findByInternalId(entityType: string, internalId: string): Promise<IdentifierMapping[]>;

  /**
   * Create mapping (standard save operation)
   */
  create(mapping: IdentifierMapping): Promise<IdentifierMapping>;

  /**
   * Insert mapping with unique violation detection
   * Used for concurrency-safe get-or-create operations
   * @throws DuplicateIdentifierMappingError if unique constraint violation occurs
   */
  insertMapping(mapping: IdentifierMapping): Promise<IdentifierMapping>;

  /**
   * Delete mapping by external key (entityType, platformType, connectionId, externalId)
   * Idempotent: no-op if mapping does not exist.
   */
  deleteByExternalKey(
    entityType: string,
    platformType: string,
    connectionId: string,
    externalId: string,
  ): Promise<void>;

  /**
   * Find all mappings for a given entity type and connection.
   */
  findByEntityTypeAndConnection(
    entityType: string,
    connectionId: string,
  ): Promise<IdentifierMapping[]>;
}

