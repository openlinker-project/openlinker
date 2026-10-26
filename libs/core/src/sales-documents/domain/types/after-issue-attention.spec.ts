/**
 * deriveAfterIssueAttention (DEF-26) - truth table.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { deriveAfterIssueAttention } from './live-order-issuance-gate.types';

describe('deriveAfterIssueAttention', () => {
  it('should say nothing when there is no document', () => {
    expect(deriveAfterIssueAttention({ kind: 'block', reason: 'order-cancelled' }, false)).toBeNull();
  });

  it('should say nothing when nothing changed', () => {
    expect(deriveAfterIssueAttention({ kind: 'allow' }, true)).toBeNull();
  });

  it('should map each live decision to its attention', () => {
    expect(deriveAfterIssueAttention({ kind: 'block', reason: 'order-cancelled' }, true)).toBe(
      'order-cancelled-after-issue',
    );
    expect(deriveAfterIssueAttention({ kind: 'block', reason: 'order-fully-refunded' }, true)).toBe(
      'order-fully-refunded-after-issue',
    );
    expect(
      deriveAfterIssueAttention({ kind: 'allow-with-attention', attention: 'order-partially-refunded' }, true),
    ).toBe('order-partially-refunded-after-issue');
  });
});
