/**
 * Price Change Copy — parsing/clamping regression tests (#3148 second
 * review, still-open BLOCKING finding).
 *
 * `parseLocalizedAmount` and `clampToStorablePrecision` back the manual
 * price entry in `EditPriceChangeDialog` — the one field in this stack
 * that, misread, silently publishes a wrong price to a live marketplace.
 * Piotr's review flagged the danger case explicitly ("1,234" parsing to
 * 1.234, ~1000x too low) and it was never covered by a test.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { describe, expect, it } from 'vitest';
import { clampToStorablePrecision, parseLocalizedAmount } from './price-change-copy';

describe('parseLocalizedAmount', () => {
  it('parses a plain integer', () => {
    expect(parseLocalizedAmount('39900')).toBe(39900);
  });

  it('parses a lone comma with 1 or 2 trailing digits as a decimal separator', () => {
    expect(parseLocalizedAmount('1,5')).toBe(1.5);
    expect(parseLocalizedAmount('399,50')).toBe(399.5);
  });

  it('parses a lone dot with 1 or 2 trailing digits as a decimal separator', () => {
    expect(parseLocalizedAmount('1.5')).toBe(1.5);
    expect(parseLocalizedAmount('399.50')).toBe(399.5);
  });

  it('refuses a lone comma followed by exactly 3 digits — the ambiguous "1,234" case', () => {
    // The regression this exists to close: `Number(raw.replace(',', '.'))`
    // silently parsed this to 1.234 - a price ~1000x too low with no error.
    expect(Number.isNaN(parseLocalizedAmount('1,234'))).toBe(true);
    expect(Number.isNaN(parseLocalizedAmount('12,345'))).toBe(true);
  });

  it('refuses a lone dot followed by exactly 3 digits — the same ambiguity mirrored', () => {
    expect(Number.isNaN(parseLocalizedAmount('1.234'))).toBe(true);
  });

  it('treats a single comma with a space-separated thousands group as unambiguous', () => {
    expect(parseLocalizedAmount('1 234,56')).toBe(1234.56);
  });

  it('treats a dot-grouped, comma-decimal value as unambiguous', () => {
    expect(parseLocalizedAmount('1.234,56')).toBe(1234.56);
  });

  it('treats a comma-grouped, dot-decimal value as unambiguous', () => {
    expect(parseLocalizedAmount('1,234.56')).toBe(1234.56);
  });

  it('treats more than one comma as unambiguous thousands grouping', () => {
    expect(parseLocalizedAmount('1,234,567')).toBe(1234567);
  });

  it('treats more than one dot as unambiguous thousands grouping', () => {
    expect(parseLocalizedAmount('1.234.567')).toBe(1234567);
  });

  it('returns NaN for empty or non-numeric input', () => {
    expect(Number.isNaN(parseLocalizedAmount(''))).toBe(true);
    expect(Number.isNaN(parseLocalizedAmount('abc'))).toBe(true);
  });
});

describe('clampToStorablePrecision', () => {
  it('clamps to 2 decimal places for an ordinary currency', () => {
    expect(clampToStorablePrecision(399.999, 'PLN')).toBe(400);
    expect(clampToStorablePrecision(399.505, 'EUR')).toBe(399.51);
  });

  it('clamps to 0 decimal places for a zero-decimal currency', () => {
    expect(clampToStorablePrecision(399.6, 'JPY')).toBe(400);
  });

  it('falls back to 2 decimal places when the currency is absent or unrecognized', () => {
    expect(clampToStorablePrecision(399.999, null)).toBe(400);
    expect(clampToStorablePrecision(399.999, undefined)).toBe(400);
  });
});
