/**
 * Identifier Mapping Conflict Exception
 *
 * Domain exception thrown when attempting to create a mapping that conflicts with
 * an existing mapping. For example, when trying to map an external ID to a different
 * internal ID than the one it's already mapped to.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class IdentifierMappingConflictException extends Error {
  constructor(
    public readonly entityType: string,
    public readonly externalId: string,
    public readonly connectionId: string,
    public readonly existingInternalId: string,
    public readonly requestedInternalId: string,
  ) {
    super(
      `Mapping conflict: ${entityType}:${externalId}@${connectionId} is already mapped to ${existingInternalId}, cannot map to ${requestedInternalId}`,
    );
    this.name = 'IdentifierMappingConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
