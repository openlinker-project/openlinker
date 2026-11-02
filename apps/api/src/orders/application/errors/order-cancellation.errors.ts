/**
 * Order Cancellation Errors (#3540)
 *
 * One refusal class with a closed machine code, so the controller maps every
 * 409 from one place and the operator-facing copy keys on the code (the
 * `ORDER_ALREADY_ON_HOLD` precedent), never on the message.
 *
 * @module apps/api/src/orders/application/errors
 */

export const OrderCancellationRefusalCodeValues = [
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_HAS_FISCAL_RECEIPT',
  'INVOICE_NOT_SETTLED',
  'ORDER_CANCEL_IN_FLIGHT',
  'ORDER_WORK_ACCEPTED_NEEDS_ACK',
  'ORDER_CANCEL_CONTENDED',
  'LABEL_NOT_VOIDABLE',
  'CHANNEL_REFUSED_CANCEL',
  'CHANGE_ALREADY_CONFIRMED',
  'CHANGE_EXPIRED',
  'CHANGE_NOT_OPEN',
  'CHANGE_KIND_NOT_CONFIRMABLE',
  'CORRECTION_SUPERSEDED',
  'CORRECTION_IN_PROGRESS',
  'CORRECTION_NEEDS_RECONCILIATION',
] as const;
export type OrderCancellationRefusalCode = (typeof OrderCancellationRefusalCodeValues)[number];

/** A 409: the request was well formed and the order or change is in a state that refuses it. */
export class OrderCancellationRefusedError extends Error {
  constructor(
    public readonly code: OrderCancellationRefusalCode,
    message: string
  ) {
    super(message);
    this.name = 'OrderCancellationRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 404: no such order, or no such change on this order. */
export class OrderCancellationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderCancellationNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 400: `other` was chosen without saying what the other reason is. */
export class OrderCancellationNoteRequiredError extends Error {
  constructor() {
    super('A note is required when the cancellation reason is "other".');
    this.name = 'OrderCancellationNoteRequiredError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 400: the reason is not one of the closed cancel reasons. */
export class OrderCancellationInvalidReasonError extends Error {
  constructor(public readonly reason: string) {
    super(`"${reason}" is not a valid cancellation reason.`);
    this.name = 'OrderCancellationInvalidReasonError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 422: the invoicing provider failed the credit correction; the change stays open. */
export class CancelCorrectionFailedError extends Error {
  constructor(
    message: string,
    public readonly failureCode: string | null
  ) {
    super(message);
    this.name = 'CancelCorrectionFailedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
