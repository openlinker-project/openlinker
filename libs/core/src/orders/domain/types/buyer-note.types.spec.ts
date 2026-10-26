import {
  decodeBuyerNoteColumn,
  encodeBuyerNoteColumn,
  hasBuyerNoteText,
  normaliseCountryColumn,
  readSourceBuyerNote,
} from './buyer-note.types';

describe('buyer note rules (#3538)', () => {
  describe('readSourceBuyerNote', () => {
    it.each([
      [undefined, undefined],
      [null, undefined],
      ['', undefined],
      ['   ', undefined],
      ['  hello  ', 'hello'],
    ])('should coerce %p to %p', (raw, expected) => {
      expect(readSourceBuyerNote(raw)).toBe(expected);
    });
  });

  describe('column codec', () => {
    it('should encode unknown as NULL, asserted none as the empty string, text verbatim', () => {
      expect(encodeBuyerNoteColumn(undefined)).toBeNull();
      expect(encodeBuyerNoteColumn(null)).toBe('');
      expect(encodeBuyerNoteColumn(' hi ')).toBe('hi');
    });

    it('should encode a whitespace-only note as not asserted, like readSourceBuyerNote', () => {
      expect(encodeBuyerNoteColumn('   ')).toBeNull();
    });

    it('should round-trip all three states', () => {
      for (const value of [undefined, null, 'text']) {
        expect(decodeBuyerNoteColumn(encodeBuyerNoteColumn(value))).toBe(value);
      }
    });
  });

  describe('hasBuyerNoteText', () => {
    it('should be true only for a real text', () => {
      expect(hasBuyerNoteText('x')).toBe(true);
      expect(hasBuyerNoteText('  ')).toBe(false);
      expect(hasBuyerNoteText(null)).toBe(false);
      expect(hasBuyerNoteText(undefined)).toBe(false);
    });
  });

  describe('normaliseCountryColumn', () => {
    it.each([
      ['pl', 'PL'],
      [' de ', 'DE'],
      ['Poland', null],
      ['', null],
      [undefined, null],
      [null, null],
    ])('should normalise %p to %p', (raw, expected) => {
      expect(normaliseCountryColumn(raw)).toBe(expected);
    });
  });
});
