/**
 * Orders errors (#3865)
 *
 * The coded HTTP errors the orders controllers send. Each carries a stable code
 * and the values the frontend's copy needs (ADR-081); `message` stays the
 * English sentence the endpoint always sent, for developers and logs. No buyer
 * data travels in `params`.
 *
 * @module apps/api/src/orders/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import type { RefundAmountPrecisionException } from '@openlinker/core/orders';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import type {
  OrderEditInvalidError,
  OrderEditNotFoundError,
} from '../application/errors/order-edit.errors';
import type { OrderCancellationNotFoundError } from '../application/errors/order-cancellation.errors';

export function orderNotFound(
  orderId: string,
  message = `Order not found: ${orderId}`
): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', message, { orderId });
}

export function orderTagNotFound(tagId: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'ORDER_TAG_NOT_FOUND',
    `Order tag not found: ${tagId}`,
    {
      tagId,
    }
  );
}

/** An order or a change on it does not exist (the cancellation flow). */
export function orderCancellationNotFound(error: OrderCancellationNotFoundError): HttpException {
  const { orderId, changeId } = error.target;
  if (changeId !== undefined) {
    return codedHttpError(HttpStatus.NOT_FOUND, 'ORDER_CHANGE_NOT_FOUND', error.message, {
      orderId,
      changeId,
    });
  }
  return orderNotFound(orderId, error.message);
}

/** An edit names an order or a line that does not exist. */
export function orderEditNotFound(error: OrderEditNotFoundError): HttpException {
  const { orderId, orderLineId } = error.target;
  if (orderLineId !== undefined) {
    return codedHttpError(HttpStatus.NOT_FOUND, 'ORDER_LINE_NOT_FOUND', error.message, {
      orderId,
      orderLineId,
    });
  }
  return orderNotFound(orderId, error.message);
}

/** The edit payload cannot describe an edit. */
export function orderEditInvalid(error: OrderEditInvalidError): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'ORDER_EDIT_INVALID', error.message, {
    reason: error.reason,
    ...error.details,
  });
}

/** A refund amount has more decimal places than its currency allows. */
export function refundAmountPrecision(error: RefundAmountPrecisionException): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'REFUND_AMOUNT_PRECISION', error.message, {
    amount: error.amount,
    currency: error.currency,
    allowedFractionDigits: error.allowedFractionDigits,
  });
}
