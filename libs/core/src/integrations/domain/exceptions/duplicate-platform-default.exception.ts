/**
 * Duplicate Platform Default Exception
 *
 * Domain exception thrown when a second adapter for the same `platformType`
 * tries to register itself as the default (`isDefault: true`). At most one
 * default adapter per platformType is permitted — `IntegrationsService`
 * resolves an unspecified `connection.adapterKey` through it, so two defaults
 * would make the resolution non-deterministic. (#571)
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class DuplicatePlatformDefaultException extends Error {
  constructor(platformType: string, existingAdapterKey: string, conflictingAdapterKey: string) {
    super(
      `Default adapter for platformType '${platformType}' already registered ` +
        `as ${existingAdapterKey}; cannot also register ${conflictingAdapterKey} ` +
        `as default. At most one isDefault adapter is permitted per platformType.`,
    );
    this.name = 'DuplicatePlatformDefaultException';
    Error.captureStackTrace(this, this.constructor);
  }
}
