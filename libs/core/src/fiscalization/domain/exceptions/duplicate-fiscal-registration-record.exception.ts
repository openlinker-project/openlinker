/**
 * Duplicate Fiscal Registration Record Exception
 *
 * Domain error raised when a `create` collides with the exactly-once guard - the
 * PLAIN unique index on `(connectionId, idempotencyKey)` (ADR-042 decision 6).
 * The repository converts the Postgres unique violation into this domain error
 * so the application layer never sees `QueryFailedError`.
 *
 * It is not a failure: the service catches it, re-reads the winner by key and
 * resumes that row under the fiscal-safety invariant. That is the create-race
 * half of the exactly-once guarantee.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class DuplicateFiscalRegistrationRecordException extends Error {
  constructor(connectionId: string, idempotencyKey: string) {
    super(
      `Fiscal registration record already exists for connection ${connectionId} ` +
        `with idempotency key ${idempotencyKey}`,
    );
    this.name = 'DuplicateFiscalRegistrationRecordException';
    Error.captureStackTrace(this, this.constructor);
  }
}
