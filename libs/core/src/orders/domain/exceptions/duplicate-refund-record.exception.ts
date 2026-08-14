/**
 * Duplicate Refund Record Exception
 *
 * Domain error raised when a `create` collides with the refund dedup guard
 * (the partial-unique index on `(internalOrderId, idempotencyKey)`, #2036 —
 * mirrors `DuplicateInvoiceRecordException`). The repository converts the
 * Postgres unique-violation into this domain error so the application layer
 * never sees `QueryFailedError` — a retried record-refund with the same key
 * against the same order cannot silently insert a second row and inflate
 * `RefundSummary.totalAmount`.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class DuplicateRefundRecordException extends Error {
  constructor(internalOrderId: string, idempotencyKey: string) {
    super(
      `Refund record already exists for order ${internalOrderId} with idempotency key ${idempotencyKey}`,
    );
    this.name = 'DuplicateRefundRecordException';
    Error.captureStackTrace(this, this.constructor);
  }
}
