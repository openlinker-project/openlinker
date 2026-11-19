import { deriveOrderRefundState } from './refund-state.types';
import type { RefundCeilingOrderFacts } from './refund-ceiling.types';
import type { RefundSummary } from './refund-record.types';

const order = (over: Partial<RefundCeilingOrderFacts> = {}): RefundCeilingOrderFacts => ({
  totalAmount: 623.49,
  currency: 'PLN',
  taxTreatment: null,
  totalTaxTreatment: null,
  ...over,
});
const refunds = (totalAmount: string, currency = 'PLN', count = 1): RefundSummary => ({
  count,
  totalAmount,
  currency,
});

describe('deriveOrderRefundState', () => {
  it('should read none when the order has no refund records', () => {
    expect(deriveOrderRefundState(order(), null).state).toBe('none');
    expect(deriveOrderRefundState(order(), refunds('0.00', 'PLN', 0)).state).toBe('none');
  });

  it('should read partial when refunds are between zero and the total', () => {
    expect(deriveOrderRefundState(order(), refunds('317.22'))).toEqual({
      state: 'partial',
      refundedAmount: '317.22',
      currency: 'PLN',
    });
  });

  it('should read full when refunds equal the total', () => {
    expect(deriveOrderRefundState(order(), refunds('623.49')).state).toBe('full');
  });

  it('should read full when an acknowledged refund exceeds the total', () => {
    expect(deriveOrderRefundState(order(), refunds('700.00')).state).toBe('full');
  });

  it('should read unknown when the refund currency differs from the order currency', () => {
    expect(deriveOrderRefundState(order(), refunds('10.00', 'EUR')).state).toBe('unknown');
  });

  it('should read unknown when the order total is missing or tax-exclusive', () => {
    expect(deriveOrderRefundState(order({ totalAmount: null }), refunds('10.00')).state).toBe(
      'unknown'
    );
    expect(
      deriveOrderRefundState(order({ totalTaxTreatment: 'exclusive' }), refunds('10.00')).state
    ).toBe('unknown');
    expect(deriveOrderRefundState(null, refunds('10.00')).state).toBe('unknown');
  });
});
