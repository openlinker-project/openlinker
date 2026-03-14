/**
 * Duplicate Identifier Mapping Error
 *
 * Domain exception thrown when attempting to create an identifier mapping
 * that already exists. This error is thrown by the repository when a unique
 * constraint violation occurs, allowing the service to handle concurrency
 * cases appropriately.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class DuplicateIdentifierMappingError extends Error {
  constructor(
    entityType: string,
    externalId: string,
    platformType: string,
    connectionId: string,
  ) {
    super(
      `Identifier mapping already exists for ${entityType}:${externalId}@${connectionId} (platform: ${platformType})`,
    );
    this.name = 'DuplicateIdentifierMappingError';
    Error.captureStackTrace(this, this.constructor);
  }
}








