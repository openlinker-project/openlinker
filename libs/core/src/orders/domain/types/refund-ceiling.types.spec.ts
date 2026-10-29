/**
 * Refund ceiling predicate and decision tests (#3289).
 *
 * @module libs/core/src/orders/domain/types
 */
import { decideRefundCeiling } from '../domain-services/refund-ceiling.domain-service';
import { RefundCeilingExceededException } from '../exceptions/refund-ceiling-exceeded.exception';
import {
  evaluateRefundCeiling,
  type RefundCeilingContext,
  type RefundCeilingOrderFacts,
} from './refund-ceiling.types';

function order(overrides: Partial<RefundCeilingOrderFacts> = {}): RefundCeilingOrderFacts {
  return {
    totalAmount: 100,
    currency: 'PLN',
    taxTreatment: null,
    totalTaxTreatment: null,
    ...overrides,
  };
}

function context(
  orderFacts: RefundCeilingOrderFacts | null,
  refunded: string | null = null,
  refundedCurrency = 'PLN'
): RefundCeilingContext {
  return {
    order: orderFacts,
    alreadyRefunded:
      refunded === null ? null : { count: 1, totalAmount: refunded, currency: refundedCurrency },
  };
}

describe('evaluateRefundCeiling', () => {
  it('should be within when the refund fits the remaining amount exactly', () => {
    const verdict = evaluateRefundCeiling({
      context: context(order(), '60.00'),
      requestedAmount: '40.00',
      requestedCurrency: 'PLN',
    });
    expect(verdict).toMatchObject({ status: 'within', ceiling: '100.00', alreadyRefunded: '60.00' });
  });

  it('should be exceeded when two returns together refund more than the order total', () => {
    const verdict = evaluateRefundCeiling({
      context: context(order(), '100.00'),
      requestedAmount: '100.00',
      requestedCurrency: 'PLN',
    });
    expect(verdict).toEqual({
      status: 'exceeded',
      ceiling: '100.00',
      alreadyRefunded: '100.00',
      requested: '100.00',
      currency: 'PLN',
    });
  });

  it('should compare in integer minor units, not floats (0.1 + 0.2 against 0.3)', () => {
    const verdict = evaluateRefundCeiling({
      context: context(order({ totalAmount: 0.3 }), '0.10'),
      requestedAmount: '0.20',
      requestedCurrency: 'PLN',
    });
    expect(verdict.status).toBe('within');
  });

  it('should use the currency minor unit (zero-decimal JPY)', () => {
    const verdict = evaluateRefundCeiling({
      context: context(order({ totalAmount: 1000, currency: 'JPY' }), '600', 'JPY'),
      requestedAmount: '401',
      requestedCurrency: 'JPY',
    });
    expect(verdict).toMatchObject({ status: 'exceeded', ceiling: '1000', requested: '401' });
  });

  it('should use three decimals for KWD', () => {
    const verdict = evaluateRefundCeiling({
      context: context(order({ totalAmount: 1.5, currency: 'KWD' })),
      requestedAmount: '1.501',
      requestedCurrency: 'KWD',
    });
    expect(verdict).toMatchObject({ status: 'exceeded', ceiling: '1.500' });
  });

  it('should read the total inclusivity as totalTaxTreatment ?? taxTreatment', () => {
    // Lines net, total gross (PrestaShop): the total is comparable to refunds.
    const gross = evaluateRefundCeiling({
      context: context(order({ taxTreatment: 'exclusive', totalTaxTreatment: 'inclusive' })),
      requestedAmount: '10.00',
      requestedCurrency: 'PLN',
    });
    expect(gross.status).toBe('within');

    const net = evaluateRefundCeiling({
      context: context(order({ taxTreatment: 'inclusive', totalTaxTreatment: 'exclusive' })),
      requestedAmount: '10.00',
      requestedCurrency: 'PLN',
    });
    expect(net).toEqual({ status: 'unknown', reason: 'total-excludes-tax' });

    const fallback = evaluateRefundCeiling({
      context: context(order({ taxTreatment: 'exclusive' })),
      requestedAmount: '10.00',
      requestedCurrency: 'PLN',
    });
    expect(fallback).toEqual({ status: 'unknown', reason: 'total-excludes-tax' });
  });

  it.each([
    ['no context', null, 'order-unresolved'],
    ['unresolved order', context(null), 'order-unresolved'],
    ['null total', context(order({ totalAmount: null })), 'order-total-unknown'],
    ['null currency', context(order({ currency: null })), 'order-currency-unknown'],
    ['other currency', context(order({ currency: 'EUR' })), 'currency-differs'],
    ['prior refunds in another currency', context(order(), '5.00', 'EUR'), 'currency-differs'],
  ])('should report the ceiling as unknown for %s', (_label, ctx, reason) => {
    const verdict = evaluateRefundCeiling({
      context: ctx,
      requestedAmount: '10.00',
      requestedCurrency: 'PLN',
    });
    expect(verdict).toEqual({ status: 'unknown', reason });
  });
});

describe('decideRefundCeiling', () => {
  const exceeded = evaluateRefundCeiling({
    context: context(order(), '100.00'),
    requestedAmount: '1.00',
    requestedCurrency: 'PLN',
  });

  it('should refuse an exceeded verdict by default with the figures on the exception', () => {
    expect.assertions(3);
    try {
      decideRefundCeiling('ol_order_1', exceeded, undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(RefundCeilingExceededException);
      expect((error as RefundCeilingExceededException).code).toBe('refund_ceiling_exceeded');
      expect(error).toMatchObject({ ceiling: '100.00', alreadyRefunded: '100.00', requested: '1.00' });
    }
  });

  it('should let an acknowledged excess through', () => {
    expect(decideRefundCeiling('ol_order_1', exceeded, true)).toBe('acknowledged');
  });

  it('should proceed on an unknown ceiling whether or not it was acknowledged', () => {
    const unknown = evaluateRefundCeiling({
      context: null,
      requestedAmount: '1.00',
      requestedCurrency: 'PLN',
    });
    expect(decideRefundCeiling('o', unknown, undefined)).toBe('unknown');
    expect(decideRefundCeiling('o', unknown, true)).toBe('unknown');
  });
});
