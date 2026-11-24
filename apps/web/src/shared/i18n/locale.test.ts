/**
 * Tests for the exported BCP 47 locale resolver (#783).
 *
 * `getBcp47Locale` is the single source of truth consumers call when building
 * per-row `Intl.*` formatters with dynamic options (currency, date), instead of
 * mirroring the `'en' → 'en-GB'` mapping inline.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { getBcp47Locale } from './locale';
import { LocaleCodeValues } from './i18n.types';

describe('getBcp47Locale', () => {
  it("should map 'en' to BCP 47 'en-GB'", () => {
    expect(getBcp47Locale('en')).toBe('en-GB');
  });

  it("should map 'pl' to BCP 47 'pl-PL'", () => {
    expect(getBcp47Locale('pl')).toBe('pl-PL');
  });

  it('should resolve every supported locale to a well-formed BCP 47 tag', () => {
    for (const locale of LocaleCodeValues) {
      expect(getBcp47Locale(locale)).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    }
  });
});
