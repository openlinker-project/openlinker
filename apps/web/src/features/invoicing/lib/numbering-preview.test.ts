/**
 * numbering-preview builder unit tests (#1577)
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { describe, expect, it } from 'vitest';
import { buildNumberingPreview } from './numbering-preview';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('buildNumberingPreview', () => {
  it('tokenises the next number and marks the seq span', () => {
    const preview = buildNumberingPreview({
      pattern: 'FV/{seq}/{MM}/{YYYY}',
      nextSeq: 42,
      seqPadding: 5,
      resetPolicy: 'monthly',
      now: NOW,
    });
    expect(preview.valid).toBe(true);
    expect(preview.tokens.map((t) => t.text).join('')).toBe('FV/00042/07/2026');
    const seqToken = preview.tokens.find((t) => t.kind === 'seq');
    expect(seqToken?.text).toBe('00042');
  });

  it('produces an ordered "then" strip of the next three numbers', () => {
    const preview = buildNumberingPreview({
      pattern: 'FV/{seq}',
      nextSeq: 1,
      seqPadding: 0,
      resetPolicy: 'none',
      now: NOW,
    });
    expect(preview.then).toEqual(['FV/2', 'FV/3', 'FV/4']);
  });

  it('is invalid (no tokens) when the pattern breaks the reset rule', () => {
    const preview = buildNumberingPreview({
      pattern: 'FV/{seq}/{YYYY}',
      nextSeq: 1,
      seqPadding: 0,
      resetPolicy: 'monthly',
      now: NOW,
    });
    expect(preview.valid).toBe(false);
    expect(preview.tokens).toEqual([]);
    expect(preview.then).toEqual([]);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('is invalid when nextSeq is below 1', () => {
    const preview = buildNumberingPreview({
      pattern: 'FV/{seq}',
      nextSeq: 0,
      seqPadding: 0,
      resetPolicy: 'none',
      now: NOW,
    });
    expect(preview.valid).toBe(false);
  });
});
