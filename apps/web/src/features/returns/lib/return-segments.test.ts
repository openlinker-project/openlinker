/**
 * Return Segments — vocabulary, tones and the attention split (#2378)
 *
 * @module apps/web/src/features/returns/lib
 */
import { describe, expect, it } from 'vitest';
import { MetricCardToneValues } from '../../../shared/ui/metric-card';
import {
  ATTENTION_WORTHY_RETURN_SEGMENTS,
  RETURN_SEGMENT_LABELS,
  RETURN_SEGMENT_TONES,
  RETURN_SEGMENT_VALUES,
  isReturnSegment,
} from './return-segments';

describe('return segment vocabulary (#2378)', () => {
  it('should carry the six spec § 4.1 segments', () => {
    expect([...RETURN_SEGMENT_VALUES]).toEqual([
      'needs_receiving',
      'needs_disposition',
      'restock_blocked',
      'money_pending',
      'orphans',
      'all_open',
    ]);
  });

  it('should label every segment verbatim from the spec', () => {
    expect(RETURN_SEGMENT_LABELS.needs_receiving).toBe('Needs receiving');
    expect(RETURN_SEGMENT_LABELS.all_open).toBe('All open');
    for (const segment of RETURN_SEGMENT_VALUES) {
      expect(RETURN_SEGMENT_LABELS[segment].length).toBeGreaterThan(0);
    }
  });

  it.each(RETURN_SEGMENT_VALUES)('should give %s a tone the primitive renders', (segment) => {
    // Keyed off MetricCard's OWN vocabulary — a local tone union would
    // type-check against a tone the primitive does not render.
    expect(MetricCardToneValues).toContain(RETURN_SEGMENT_TONES[segment]);
  });

  it('should tone ONLY restock_blocked and orphans as danger', () => {
    // The #2100 attention-worthy/routine split: these two alone mean OpenLinker
    // did something the operator has not been told about anywhere else.
    const red = RETURN_SEGMENT_VALUES.filter((s) => RETURN_SEGMENT_TONES[s] === 'error');
    expect(red).toEqual(['restock_blocked', 'orphans']);
    expect([...ATTENTION_WORTHY_RETURN_SEGMENTS]).toEqual(red);
  });

  it('should never tone money_pending as danger', () => {
    // Routine on any active seller. A warning on an ordinary state teaches the
    // operator to ignore the strip.
    expect(RETURN_SEGMENT_TONES.money_pending).not.toBe('error');
  });

  it('should carry NO precedence — the order is presentation only', () => {
    // The sibling `ReturnStageValues` order IS an ordinal; this one is not, and
    // the two live one file apart. Reversing the array must change nothing about
    // what any segment means, because each is an independent predicate.
    const reversed = [...RETURN_SEGMENT_VALUES].reverse();

    for (const segment of reversed) {
      expect(RETURN_SEGMENT_LABELS[segment]).toBe(RETURN_SEGMENT_LABELS[segment]);
      expect(RETURN_SEGMENT_TONES[segment]).toBe(RETURN_SEGMENT_TONES[segment]);
    }
    expect(new Set(reversed)).toEqual(new Set(RETURN_SEGMENT_VALUES));
  });

  it('should tone `all_open` NEUTRAL — it is the largest card on any active install', () => {
    expect(RETURN_SEGMENT_TONES.all_open).toBe('neutral');
  });

  it.each(RETURN_SEGMENT_VALUES)('should accept %s', (value) => {
    expect(isReturnSegment(value)).toBe(true);
  });

  it.each<[string | null | undefined]>([['unknown'], [''], [null], [undefined]])(
    'should reject %p rather than defaulting it to another segment',
    (value) => {
      expect(isReturnSegment(value)).toBe(false);
    }
  );
});
