/**
 * Barcode Normalization Tests
 *
 * Unit tests for normalizeBarcode helper.
 *
 * @module libs/core/src/products/domain/utils/__tests__
 */
import { normalizeBarcode } from '../barcode-normalization';

describe('normalizeBarcode', () => {
  it('returns null for empty input', () => {
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode('   ')).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
    expect(normalizeBarcode(undefined)).toBeNull();
  });

  it('strips non-digit characters and preserves leading zeros', () => {
    expect(normalizeBarcode('  000-123-456-7890 ')).toBe('0001234567890');
  });

  it('accepts valid GTIN lengths', () => {
    expect(normalizeBarcode('12345678')).toBe('12345678');
    expect(normalizeBarcode('1234567890')).toBe('1234567890');
    expect(normalizeBarcode('123456789012')).toBe('123456789012');
    expect(normalizeBarcode('1234567890123')).toBe('1234567890123');
    expect(normalizeBarcode('12345678901234')).toBe('12345678901234');
  });

  it('rejects invalid lengths', () => {
    expect(normalizeBarcode('123')).toBeNull();
    expect(normalizeBarcode('123456789')).toBeNull();
    expect(normalizeBarcode('123456789012345')).toBeNull();
  });
});
