/**
 * Order Edit Errors (#3542)
 *
 * One refusal class with a closed machine code, so the controller maps every 409
 * from one place and operator-facing copy keys on the code (the
 * `OrderCancellationRefusedError` precedent), never on the message. Each message
 * names the remedy, which is what M1's `edit-blocked` state renders.
 *
 * @module apps/api/src/orders/application/errors
 */

export const OrderEditRefusalCodeValues = [
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_AMENDMENT_IN_FLIGHT',
  'ORDER_NOT_READY',
  'ORDER_PACKED',
  'LABEL_ALREADY_BOUGHT',
  'SALES_DOCUMENT_ISSUED',
  'QUANTITY_ONLY_DECREASES',
  'QUANTITY_BELOW_FULFILLED',
  'ORDER_WOULD_BE_EMPTY',
  'EDIT_AFTER_HANDOFF',
  'ORDER_WORK_ACCEPTED_NEEDS_ACK',
  'ADDRESS_EDIT_NEEDS_PII_STORAGE',
  'ORDER_EDIT_CONTENDED',
  'NOTHING_CHANGED',
  'LINE_PRICE_NOT_RESOLVABLE',
  // #3543: the discount money event.
  'DISCOUNT_EXCEEDS_TOTAL',
  'DISCOUNT_BELOW_REFUNDED',
  'ORDER_HAS_FISCAL_RECEIPT',
  'INVOICE_NOT_SETTLED',
] as const;
export type OrderEditRefusalCode = (typeof OrderEditRefusalCodeValues)[number];

/** A 409: the request was well formed and the order is in a state that refuses it. */
export class OrderEditRefusedError extends Error {
  constructor(
    public readonly code: OrderEditRefusalCode,
    message: string
  ) {
    super(message);
    this.name = 'OrderEditRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 404: no such order, or no such line on it. */
export class OrderEditNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderEditNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** A 400: the payload cannot describe an edit (a repeated line, a non-integer quantity). */
export class OrderEditInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderEditInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}
