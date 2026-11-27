/**
 * Refund Record Contended Exception (#3289)
 *
 * Another refund write holds the order's lock. Retryable: nothing was changed.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class RefundRecordContendedException extends Error {
  readonly code = 'refund_record_contended';

  constructor(readonly internalOrderId: string) {
    super(
      `Another refund is being recorded for order ${internalOrderId}; retry in a moment`
    );
    this.name = 'RefundRecordContendedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
