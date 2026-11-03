/**
 * Duplicate Bulk Batch Idempotency Key Error
 *
 * Domain error raised by the bulk-batch repository when a `create` loses
 * the race on the partial unique index over `(connectionId, idempotencyKey)`.
 * The repository translates the driver's unique violation into this error so
 * the submit service can resolve the race (return the winning batch) without
 * knowing anything about Postgres or TypeORM.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class DuplicateBulkBatchIdempotencyKeyError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly idempotencyKey: string
  ) {
    super(
      `A bulk offer creation batch already exists for connection ${connectionId} ` +
        `with idempotency key ${idempotencyKey}`
    );
    this.name = 'DuplicateBulkBatchIdempotencyKeyError';
    Error.captureStackTrace(this, this.constructor);
  }
}
