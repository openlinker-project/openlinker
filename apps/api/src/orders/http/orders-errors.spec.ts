import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundAmountPrecisionException } from '@openlinker/core/orders';
import { OrderCancellationNotFoundError } from '../application/errors/order-cancellation.errors';
import {
  OrderEditInvalidError,
  OrderEditNotFoundError,
} from '../application/errors/order-edit.errors';
import {
  orderCancellationNotFound,
  orderEditInvalid,
  orderEditNotFound,
  orderNotFound,
  refundAmountPrecision,
} from './orders-errors';

describe('orders errors (#3865)', () => {
  it('should send ORDER_NOT_FOUND with the order id', () => {
    const error = orderNotFound('ol_order_1');

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'Order not found: ol_order_1',
      params: { orderId: 'ol_order_1' },
    });
  });

  it('should tell a missing change apart from a missing order', () => {
    const change = orderCancellationNotFound(
      new OrderCancellationNotFoundError('Change not found on order ol_order_1: chg-1', {
        orderId: 'ol_order_1',
        changeId: 'chg-1',
      })
    );
    const order = orderCancellationNotFound(
      new OrderCancellationNotFoundError('Order not found: ol_order_1', { orderId: 'ol_order_1' })
    );

    expect(change.getResponse()).toMatchObject({
      code: 'ORDER_CHANGE_NOT_FOUND',
      params: { orderId: 'ol_order_1', changeId: 'chg-1' },
    });
    expect(order.getResponse()).toMatchObject({
      code: 'ORDER_NOT_FOUND',
      message: 'Order not found: ol_order_1',
    });
  });

  it('should send ORDER_LINE_NOT_FOUND for an unknown line', () => {
    const error = orderEditNotFound(
      new OrderEditNotFoundError('Order line not found: l9', {
        orderId: 'ol_order_1',
        orderLineId: 'l9',
      })
    );

    expect(error.getResponse()).toMatchObject({
      code: 'ORDER_LINE_NOT_FOUND',
      params: { orderId: 'ol_order_1', orderLineId: 'l9' },
    });
  });

  it('should send ORDER_EDIT_INVALID with the reason and its values', () => {
    const error = orderEditInvalid(
      new OrderEditInvalidError(
        'PLN has 2 decimal place(s); the discount amount has more.',
        'discount-amount-precision',
        {
          currency: 'PLN',
          decimalPlaces: 2,
        }
      )
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      code: 'ORDER_EDIT_INVALID',
      message: 'PLN has 2 decimal place(s); the discount amount has more.',
      params: { reason: 'discount-amount-precision', currency: 'PLN', decimalPlaces: 2 },
    });
  });

  it('should send REFUND_AMOUNT_PRECISION with the amount and the allowed digits', () => {
    const error = refundAmountPrecision(new RefundAmountPrecisionException('1.234', 'PLN', 2));

    expect(error.getResponse()).toMatchObject({
      code: 'REFUND_AMOUNT_PRECISION',
      params: { amount: '1.234', currency: 'PLN', allowedFractionDigits: 2 },
    });
  });
});
