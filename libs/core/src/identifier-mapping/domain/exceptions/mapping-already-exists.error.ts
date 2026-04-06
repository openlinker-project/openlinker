/**
 * Mapping Already Exists Error
 *
 * Domain exception thrown when attempting to create an explicit mapping via
 * createMapping() for an externalId that already has a mapping. Callers that
 * want get-or-create semantics should use getOrCreateInternalId() instead.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class MappingAlreadyExistsError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly externalId: string,
    public readonly connectionId: string,
    public readonly existingInternalId: string,
  ) {
    super(
      `Mapping already exists for ${entityType}:${externalId}@${connectionId} -> ${existingInternalId}`,
    );
    this.name = 'MappingAlreadyExistsError';
    Error.captureStackTrace(this, this.constructor);
  }
}
