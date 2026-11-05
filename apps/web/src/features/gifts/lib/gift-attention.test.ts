/**
 * Gift attention tests (#3940, #3935)
 */
import { describe, expect, it } from 'vitest';
import type { GiftAttentionEntry } from '../api/gifts.types';
import { readGiftAttention } from './gift-attention';

function entry(overrides: Partial<GiftAttentionEntry> = {}): GiftAttentionEntry {
  return {
    runId: 'run-1',
    ruleId: 'rule-1',
    ruleName: 'Sample promotion',
    outcome: 'not-applied',
    reasonCode: 'gift-out-of-stock',
    dismissed: false,
    firedAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('readGiftAttention', () => {
  it('should name an out-of-stock gift from the entry the API reported', () => {
    expect(readGiftAttention([entry()])).toEqual([
      { runId: 'run-1', kind: 'out-of-stock', ruleId: 'rule-1', ruleName: 'Sample promotion', firedAt: '2026-11-02T10:00:00.000Z' },
    ]);
  });

  it.each([
    ['paused-unit-cap', 'limit-reached'],
    ['unit-cap-reached', 'limit-reached'],
    ['customer-limit-reached', 'customer-limit'],
    ['customer-unknown', 'customer-unknown'],
    ['below-per-unit-threshold', 'below-threshold'],
    ['superseded-by-earlier-rule', 'superseded'],
    ['gift-stock-unknown', 'stock-unknown'],
  ])('should read %s as %s', (reasonCode, kind) => {
    expect(readGiftAttention([entry({ reasonCode })])[0].kind).toBe(kind);
  });

  it('should keep a reason it does not know, or none, as a generic notice', () => {
    expect(readGiftAttention([entry({ reasonCode: 'something-new' })])[0].kind).toBe('other');
    expect(readGiftAttention([entry({ reasonCode: null })])[0].kind).toBe('other');
  });

  it('should list a rule that failed outright', () => {
    expect(readGiftAttention([entry({ outcome: 'failed', reasonCode: null })])[0].kind).toBe('failed');
  });

  it('should not list a gift already in the order or a handled run', () => {
    expect(readGiftAttention([entry({ reasonCode: 'gift-already-in-order' })])).toEqual([]);
    expect(readGiftAttention([entry({ dismissed: true })])).toEqual([]);
  });
});
