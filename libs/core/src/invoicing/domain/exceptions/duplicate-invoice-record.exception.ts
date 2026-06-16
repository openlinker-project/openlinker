/**
 * Duplicate Invoice Record Exception
 *
 * Domain error raised when a `create` collides with the fiscal-dedup guard
 * (the partial-unique index on `(connectionId, idempotencyKey)`). The repository
 * converts the Postgres unique-violation into this domain error so the
 * application layer never sees `QueryFailedError` — exactly-once issuance: a
 * retried issue with the same key cannot create a second document.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class DuplicateInvoiceRecordException extends Error {
  constructor(connectionId: string, idempotencyKey: string) {
    super(
      `Invoice record already exists for connection ${connectionId} with idempotency key ${idempotencyKey}`,
    );
    this.name = 'DuplicateInvoiceRecordException';
    Error.captureStackTrace(this, this.constructor);
  }
}
