import { describe, expect, it } from 'vitest';

import {
  ATTENTION_REASON_MIRROR,
  AuthorityAttentionBadgeValues,
  AuthorityAttentionCountedReasonValues,
  AuthorityAttentionReasonValues,
  attentionBadgeTone,
  isAuthorityAttentionReason,
} from './attention-reason';
import {
  ATTENTION_BADGE_COPY,
  ATTENTION_REASON_COPY,
  ATTENTION_UNKNOWN_COPY,
  attentionTitle,
  listAttentionReasonCopy,
} from './attention-reason.copy';

describe('attention-reason copy', () => {
  // The table-driven "every union value yields copy" assertion the mirror
  // script's header names as its second guard (the `order-row.test.ts` shape).
  it.each(AuthorityAttentionReasonValues)('should give %s a non-empty title, body and action', (reason) => {
    const copy = ATTENTION_REASON_COPY[reason];
    expect(copy.title.trim()).not.toBe('');
    expect(copy.titleFallback.trim()).not.toBe('');
    expect(copy.body.trim()).not.toBe('');
    expect(copy.action.trim()).not.toBe('');
  });

  it.each(AuthorityAttentionReasonValues)('should leave no placeholder in %s titleFallback', (reason) => {
    expect(ATTENTION_REASON_COPY[reason].titleFallback).not.toMatch(/\{[a-z]+\}/);
  });

  it.each(AuthorityAttentionBadgeValues)('should give badge %s a label and a StatusBadge tone', (badge) => {
    expect(ATTENTION_BADGE_COPY[badge].trim()).not.toBe('');
    expect(['error', 'warning', 'neutral']).toContain(attentionBadgeTone(badge));
  });

  describe('attentionTitle', () => {
    it('should substitute every placeholder when each has a value', () => {
      expect(attentionTitle('reservation-shortfall', { ref: 'A-1001', n: 3, sku: 'SKU-9' })).toBe(
        'Order A-1001 is short 3 × SKU-9',
      );
    });

    it('should accept a numeric count without the caller stringifying it', () => {
      expect(attentionTitle('line-unfulfillable', { ref: 'A-1', n: 2 })).toContain('2 line(s)');
    });

    // The regression this exists to prevent: an operator must never be shown a
    // literal `{ref}`. Unreachable from a well-typed call site; reachable from
    // a value that arrives empty off the wire.
    it('should fall back to a complete sentence when a placeholder has no value', () => {
      const title = attentionTitle('fulfillment-unaccepted', {});
      expect(title).toBe(ATTENTION_REASON_COPY['fulfillment-unaccepted'].titleFallback);
      expect(title).not.toContain('{');
    });

    it('should treat a blank string as missing rather than render a gap', () => {
      expect(attentionTitle('sourcing-ambiguous', { channel: '   ' })).toBe(
        ATTENTION_REASON_COPY['sourcing-ambiguous'].titleFallback,
      );
    });

    it('should render a placeholder-free title unchanged', () => {
      expect(attentionTitle('availability-unknown')).toBe(
        ATTENTION_REASON_COPY['availability-unknown'].title,
      );
    });
  });

  describe('counted subset', () => {
    // A2-`none` and every other routine state lives on the who-decides row as
    // an AuthorityState, never in this union — so a zero-config install cannot
    // count anything (#2356's regression test).
    it('should derive the counted subset from the mirror, not a hand-written list', () => {
      const expected = AuthorityAttentionReasonValues.filter(
        (reason) => ATTENTION_REASON_MIRROR[reason].counted,
      );
      expect(AuthorityAttentionCountedReasonValues).toEqual(expected);
    });

    it('should count every member today', () => {
      expect(AuthorityAttentionCountedReasonValues).toHaveLength(AuthorityAttentionReasonValues.length);
    });
  });

  describe('unknown reasons', () => {
    it('should reject a value this build does not recognise', () => {
      expect(isAuthorityAttentionReason('automation-failed')).toBe(false);
      expect(isAuthorityAttentionReason(undefined)).toBe(false);
      expect(isAuthorityAttentionReason(7)).toBe(false);
    });

    it('should accept every declared reason', () => {
      for (const reason of AuthorityAttentionReasonValues) {
        expect(isAuthorityAttentionReason(reason)).toBe(true);
      }
    });

    // Owned here so #2354's table and #2356's row cannot invent two sentences
    // for the same state.
    it('should own the neutral copy for an unrecognised reason', () => {
      expect(ATTENTION_UNKNOWN_COPY.title.trim()).not.toBe('');
      expect(ATTENTION_UNKNOWN_COPY.body.trim()).not.toBe('');
    });
  });

  describe('render order', () => {
    it('should list copy in AuthorityAttentionReasonValues order', () => {
      expect(listAttentionReasonCopy().map((entry) => entry.reason)).toEqual([
        ...AuthorityAttentionReasonValues,
      ]);
    });
  });
});
