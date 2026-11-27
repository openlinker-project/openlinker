/**
 * Live Order Issuance Gate — truth table (DEF-26)
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { decideLiveOrderIssuance } from './live-order-issuance-gate.types';

describe('decideLiveOrderIssuance', () => {
  it.each([
    [{ cancelled: true }, { kind: 'block', reason: 'order-cancelled' }],
    [{ cancelled: false, status: 'cancelled' }, { kind: 'block', reason: 'order-cancelled' }],
    [{ cancelled: false, status: 'refunded' }, { kind: 'block', reason: 'order-fully-refunded' }],
    [
      { cancelled: false, status: 'refunded', refundedTotal: 40, orderTotal: 100 },
      { kind: 'allow-with-attention', attention: 'order-partially-refunded' },
    ],
    [
      { cancelled: false, status: 'processing', refundedTotal: 100, orderTotal: 100 },
      { kind: 'block', reason: 'order-fully-refunded' },
    ],
    [
      { cancelled: false, status: 'processing', refundedTotal: 99.996, orderTotal: 100 },
      { kind: 'block', reason: 'order-fully-refunded' },
    ],
    [{ cancelled: false, status: 'processing' }, { kind: 'allow' }],
    [{ cancelled: false }, { kind: 'allow' }],
    [{ cancelled: false, status: 'delivered', refundedTotal: 0, orderTotal: 100 }, { kind: 'allow' }],
  ])('%j -> %j', (facts, expected) => {
    expect(decideLiveOrderIssuance(facts)).toEqual(expected);
  });
});
