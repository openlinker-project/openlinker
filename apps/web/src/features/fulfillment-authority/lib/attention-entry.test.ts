/**
 * Attention entry view model — unit tests.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 */
import { describe, expect, it } from 'vitest';
import { countAttentionEntries, toAttentionEntryView } from './attention-entry';
import { ATTENTION_REASON_COPY, ATTENTION_UNKNOWN_COPY, attentionTitle } from './attention-reason.copy';
import { AuthorityAttentionReasonValues } from './attention-reason';

describe('toAttentionEntryView', () => {
  it('should produce the title through attentionTitle for every known reason', () => {
    for (const reason of AuthorityAttentionReasonValues) {
      const view = toAttentionEntryView({ reason }, { ref: 'ORD-1', n: 2, sku: 'SKU-9', channel: 'Allegro' });
      expect(view.known).toBe(true);
      // The single-producer rule: identical to what the copy module renders.
      expect(view.title).toBe(attentionTitle(reason, { ref: 'ORD-1', n: 2, sku: 'SKU-9', channel: 'Allegro' }));
      if (view.known) {
        expect(view.body).toBe(ATTENTION_REASON_COPY[reason].body);
        expect(view.action).toBe(ATTENTION_REASON_COPY[reason].action);
      }
    }
  });

  it('should fall back to a placeholder-free title when a needed value is missing', () => {
    const view = toAttentionEntryView({ reason: 'fulfillment-unaccepted' });
    expect(view.title).toBe(ATTENTION_REASON_COPY['fulfillment-unaccepted'].titleFallback);
    expect(view.title).not.toContain('{');
  });

  it('should render an unrecognised reason neutrally and keep the raw value', () => {
    const view = toAttentionEntryView({ reason: 'invented-by-a-newer-release', since: '2026-08-01T00:00:00Z' });
    expect(view.known).toBe(false);
    expect(view.title).toBe(ATTENTION_UNKNOWN_COPY.title);
    if (!view.known) {
      // Kept so an operator can quote it in a support ticket (#2231's rule).
      expect(view.rawReason).toBe('invented-by-a-newer-release');
    }
    expect(view.since).toBe('2026-08-01T00:00:00Z');
  });

  it('should read a missing reason as unknown rather than throwing', () => {
    expect(toAttentionEntryView({}).known).toBe(false);
    expect(toAttentionEntryView({ reason: 42 }).known).toBe(false);
  });

  it('should treat a blank detail as absent', () => {
    expect(toAttentionEntryView({ reason: 'restock-blocked', detail: '   ' }).detail).toBeNull();
    expect(toAttentionEntryView({ reason: 'restock-blocked', detail: 'x' }).detail).toBe('x');
  });
});

describe('countAttentionEntries', () => {
  it('should count known entries and exclude an unrecognised one', () => {
    const views = [
      toAttentionEntryView({ reason: 'availability-unknown' }),
      toAttentionEntryView({ reason: 'restock-blocked' }),
      toAttentionEntryView({ reason: 'not-a-real-reason' }),
    ];
    expect(countAttentionEntries(views)).toBe(2);
  });

  it('should count nothing for an empty list', () => {
    expect(countAttentionEntries([])).toBe(0);
  });
});
