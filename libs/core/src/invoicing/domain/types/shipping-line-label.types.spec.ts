/**
 * Unit tests for {@link normalizeShippingLineName} (#1562 / #1565 review).
 */
import { normalizeShippingLineName } from './shipping-line-label.types';

describe('normalizeShippingLineName', () => {
  it('returns the value when it is a non-empty string', () => {
    expect(normalizeShippingLineName('Koszt wysyłki')).toBe('Koszt wysyłki');
  });

  it('preserves the original (untrimmed) value when it has non-blank content', () => {
    expect(normalizeShippingLineName('  Koszt wysyłki  ')).toBe('  Koszt wysyłki  ');
  });

  it('returns undefined for a blank / whitespace-only string', () => {
    expect(normalizeShippingLineName('')).toBeUndefined();
    expect(normalizeShippingLineName('   ')).toBeUndefined();
  });

  it('returns undefined for non-string JSONB values', () => {
    expect(normalizeShippingLineName(undefined)).toBeUndefined();
    expect(normalizeShippingLineName(null)).toBeUndefined();
    expect(normalizeShippingLineName(42)).toBeUndefined();
    expect(normalizeShippingLineName({ label: 'x' })).toBeUndefined();
  });
});
