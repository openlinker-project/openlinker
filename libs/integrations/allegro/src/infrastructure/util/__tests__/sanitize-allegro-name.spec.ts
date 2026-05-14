/**
 * Sanitizer Unit Tests — Allegro name fields (#420)
 *
 * Verifies the Allegro name sanitizer ASCII-normalizes Unicode punctuation
 * Allegro rejects from `body.name` and `productSet[0].product.name`. The
 * em-dash → " - " case is the empirical sandbox-failing pattern from #419's
 * round-trip repro; the rest of the table is the issue body's enumerated
 * "likely also" set.
 *
 * @module infrastructure/util
 */

import { BANNED_NAME_CHAR_MAP, sanitizeAllegroName } from '../sanitize-allegro-name';

describe('sanitizeAllegroName', () => {
  it('replaces em-dash with " - " (the sandbox-confirmed case)', () => {
    expect(sanitizeAllegroName('Smartphone — black')).toBe('Smartphone - black');
  });

  it('replaces en-dash with "-"', () => {
    expect(sanitizeAllegroName('Pages 1–10')).toBe('Pages 1-10');
  });

  it('replaces left single curly quote with straight apostrophe', () => {
    expect(sanitizeAllegroName('It‘s here')).toBe("It's here");
  });

  it('replaces right single curly quote with straight apostrophe', () => {
    expect(sanitizeAllegroName('It’s here')).toBe("It's here");
  });

  it('replaces left double curly quote with straight double quote', () => {
    expect(sanitizeAllegroName('“quoted”')).toBe('"quoted"');
  });

  it('replaces right double curly quote with straight double quote', () => {
    expect(sanitizeAllegroName('say ”hello”')).toBe('say "hello"');
  });

  it('replaces horizontal ellipsis with "..."', () => {
    expect(sanitizeAllegroName('and more…')).toBe('and more...');
  });

  it('is idempotent on clean ASCII input', () => {
    const clean = 'Aparat cyfrowy CANON PowerShot SX740 Lite Edition - srebrny';
    expect(sanitizeAllegroName(clean)).toBe(clean);
    expect(sanitizeAllegroName(sanitizeAllegroName(clean))).toBe(clean);
  });

  it('passes plain ASCII text through unchanged', () => {
    expect(sanitizeAllegroName('Smartphone XYZ-100, 64GB')).toBe('Smartphone XYZ-100, 64GB');
  });

  it('collapses runs of whitespace introduced by em-dash substitution', () => {
    // "a — b" → after raw substitution → "a  -  b" → after collapse → "a - b"
    expect(sanitizeAllegroName('a — b')).toBe('a - b');
  });

  it('collapses pre-existing operator-typed double-spaces (deliberate divergence from description sanitizer)', () => {
    expect(sanitizeAllegroName('Smartphone  black')).toBe('Smartphone black');
    expect(sanitizeAllegroName('foo   bar    baz')).toBe('foo bar baz');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeAllegroName('  hello  ')).toBe('hello');
    expect(sanitizeAllegroName('\t\nhello\n\t')).toBe('hello');
  });

  it('preserves operator casing', () => {
    expect(sanitizeAllegroName('CANON PowerShot SX740')).toBe('CANON PowerShot SX740');
    expect(sanitizeAllegroName('iPhone 15 Pro Max')).toBe('iPhone 15 Pro Max');
  });

  it('handles empty string', () => {
    expect(sanitizeAllegroName('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(sanitizeAllegroName('   ')).toBe('');
    expect(sanitizeAllegroName('\t\n')).toBe('');
  });

  it('replaces multiple banned chars in the same string', () => {
    expect(sanitizeAllegroName('“Smart” phone — “Pro” model…')).toBe(
      '"Smart" phone - "Pro" model...'
    );
  });

  it('substitutes every char in BANNED_NAME_CHAR_MAP per the table (full coverage)', () => {
    // Iterate the map directly — guarantees that adding a new banned char
    // requires either an explicit dedicated test above or the addition to
    // be reflected in this table-driven check.
    for (const [bannedChar, expectedReplacement] of Object.entries(BANNED_NAME_CHAR_MAP)) {
      const input = `before${bannedChar}after`;
      const expected = `before${expectedReplacement}after`.replace(/\s+/g, ' ').trim();
      expect(sanitizeAllegroName(input)).toBe(expected);
    }
  });
});
