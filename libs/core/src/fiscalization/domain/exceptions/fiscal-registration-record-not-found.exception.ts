/**
 * Fiscal Registration Record Not Found Exception
 *
 * Thrown when no `FiscalRegistrationRecord` matches the id - by the repository's
 * update/claim paths and by the reconciliation read.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalRegistrationRecordNotFoundException extends Error {
  constructor(id: string) {
    super(`Fiscal registration record not found: ${id}`);
    this.name = 'FiscalRegistrationRecordNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
