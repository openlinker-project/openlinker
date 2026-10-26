import {
  buildBuyerNotePreview,
  classifyBuyerNoteForList,
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

  describe('classifyBuyerNoteForList', () => {
    it('should read present when the flag is set, whatever the stored text', () => {
      expect(classifyBuyerNoteForList(true, undefined)).toBe('present');
      expect(classifyBuyerNoteForList(true, 'hi')).toBe('present');
    });

    it('should read none for an asserted-none column and unknown for a NULL one', () => {
      expect(classifyBuyerNoteForList(false, null)).toBe('none');
      expect(classifyBuyerNoteForList(false, undefined)).toBe('unknown');
    });
  });

  describe('buildBuyerNotePreview', () => {
    it('should take the first non-empty trimmed line', () => {
      expect(buildBuyerNotePreview('\n  \n  Call first \nthen deliver')).toBe('Call first');
    });

    it('should cut at 120 characters without adding an ellipsis', () => {
      expect(buildBuyerNotePreview('a'.repeat(300))).toBe('a'.repeat(120));
    });

    it('should be null when there is no text to preview', () => {
      expect(buildBuyerNotePreview(undefined)).toBeNull();
      expect(buildBuyerNotePreview(null)).toBeNull();
      expect(buildBuyerNotePreview('  \n ')).toBeNull();
    });
  });
});
