/**
 * Fallback markers - unit tests
 *
 * @module shared/i18n/missing-inspector
 */
import { describe, expect, it } from 'vitest';
import { formatPlural } from '../plural';
import { interpolate } from '../interpolate';
import { encodeMarker, hasMarker, markerIdsIn, stripMarkers, tokenizeMarkers } from './markers';

describe('fallback markers', () => {
  it('should round-trip ids of any size', () => {
    for (const id of [0, 1, 3, 4, 17, 255, 4096, 123456]) {
      const marked = encodeMarker(id, 'Save');
      expect(markerIdsIn(marked)).toEqual([id]);
      expect(stripMarkers(marked)).toBe('Save');
    }
  });

  it('should add only zero-width characters around the text', () => {
    const marked = encodeMarker(42, 'Save');
    expect(hasMarker(marked)).toBe(true);
    expect(hasMarker('Save')).toBe(false);
    expect(marked.replace(/[\u200B-\u200D\u2060-\u2064]/g, '')).toBe('Save');
  });

  it('should survive interpolation and keep a nested marker of its own', () => {
    const outer = encodeMarker(1, 'Sent to {name}');
    const inner = encodeMarker(2, 'Allegro');
    const result = interpolate(outer, { name: inner });
    expect(markerIdsIn(result)).toEqual([1, 2]);
    expect(stripMarkers(result)).toBe('Sent to Allegro');
    expect(tokenizeMarkers(result).map((token) => token.type)).toEqual(['open', 'open', 'close', 'close']);
  });

  it('should survive plural selection', () => {
    const forms = { one: '{n} order', other: encodeMarker(5, '{n} orders') };
    const result = formatPlural(3, forms, 'en');
    expect(markerIdsIn(result)).toEqual([5]);
    expect(stripMarkers(result)).toBe('3 orders');
  });

  it('should reject an invalid id', () => {
    expect(() => encodeMarker(-1, 'x')).toThrow('invalid marker id');
  });
});
