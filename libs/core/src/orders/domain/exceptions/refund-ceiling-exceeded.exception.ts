/**
 * Refund Ceiling Exceeded Exception (#3289)
 *
 * Raised when a refund would push the order's cumulative refunds past its
 * total and the caller did not set `acknowledgeAboveCeiling`. Carries the
 * figures as fields so a structured rendering never parses the message.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
import { REFUND_CEILING_EXCEEDED_CODE } from '../types/refund-ceiling.types';

export class RefundCeilingExceededException extends Error {
  readonly code = REFUND_CEILING_EXCEEDED_CODE;

  constructor(
    readonly internalOrderId: string,
    readonly ceiling: string,
    readonly alreadyRefunded: string,
    readonly requested: string,
    readonly currency: string
  ) {
    super(
      `Refund would exceed the order's total: order ${internalOrderId} ceiling ` +
        `${ceiling} ${currency}, already refunded ${alreadyRefunded}, requested ${requested}. ` +
        'Resubmit with acknowledgeAboveCeiling to record it deliberately.'
    );
    this.name = 'RefundCeilingExceededException';
    Error.captureStackTrace(this, this.constructor);
  }
}
