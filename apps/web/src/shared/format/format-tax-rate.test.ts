/**
 * formatTaxRate — unit tests (#2254)
 *
 * The vocabulary is percent-as-string PLUS exemption codes, so the one thing
 * that must not happen is a `%` glued onto a non-numeric code.
 */
import { describe, it, expect } from 'vitest';
import { formatTaxRate } from './format-tax-rate';

describe('formatTaxRate', () => {
  it('renders a numeric code as a percentage', () => {
    expect(formatTaxRate('23')).toBe('23%');
    expect(formatTaxRate('8')).toBe('8%');
    expect(formatTaxRate('5.5')).toBe('5.5%');
  });

  it('renders a zero rate as 0% rather than as absence', () => {
    expect(formatTaxRate('0')).toBe('0%');
  });

  it('renders an exemption code as itself, with no percent suffix', () => {
    for (const code of ['zw', 'np', 'oo']) {
      expect(formatTaxRate(code)).toBe(code);
    }
  });
});
