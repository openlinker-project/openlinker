/**
 * Duplicate Location Code Error
 *
 * Raised when creating or updating a location would violate
 * `UQ_inventory_locations_code`. The repository converts the driver's
 * `QueryFailedError` into this domain error so nothing infrastructure-shaped
 * escapes `LocationRepositoryPort` (the repository error-handling rule in
 * `engineering-standards.md`).
 *
 * The interface layer (#2316) maps it to a 4xx — a duplicate code is operator
 * input, never a 500.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class DuplicateLocationCodeError extends Error {
  constructor(public readonly code: string) {
    super(`Inventory location code already exists: ${code}`);
    this.name = 'DuplicateLocationCodeError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuplicateLocationCodeError);
    }
  }
}
