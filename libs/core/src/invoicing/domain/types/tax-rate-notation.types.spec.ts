/**
 * Tax-Rate Notation Tests (#2247)
 *
 * Pins the one canonical reading of `InvoiceLine.taxRate`: percent-as-string.
 * The cases that matter are the ambiguous ones - a fractional spelling must
 * raise rather than resolve, and a genuine sub-10% rate must not be mistaken
 * for one.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import {
  FractionalTaxRateNotationError,
  assertPercentTaxRateNotation,
  isFractionalTaxRateNotation,
  parseTaxRatePercent,
  taxRatePercentToFraction,
} from './tax-rate-notation.types';

describe('tax-rate notation', () => {
  describe('parseTaxRatePercent', () => {
    it('should read a numeric code as a percentage when the code is well formed', () => {
      expect(parseTaxRatePercent('23')).toBe(23);
      expect(parseTaxRatePercent('8')).toBe(8);
      expect(parseTaxRatePercent('5')).toBe(5);
    });

    it('should treat zero as an answer rather than an absence when the code is "0"', () => {
      expect(parseTaxRatePercent('0')).toBe(0);
    });

    it('should read a one-percent rate as one percent when the code is "1"', () => {
      // The pre-#2247 inFakt heuristic (`n > 1 ? n / 100 : n`) read this as 100%.
      expect(parseTaxRatePercent('1')).toBe(1);
      expect(taxRatePercentToFraction('1')).toBeCloseTo(0.01, 10);
    });

    it('should return null when the code names an exemption rather than a percentage', () => {
      expect(parseTaxRatePercent('zw')).toBeNull();
      expect(parseTaxRatePercent('np')).toBeNull();
      expect(parseTaxRatePercent('oo')).toBeNull();
    });

    it('should return null when the code is empty, preserving the pre-rollout path', () => {
      expect(parseTaxRatePercent('')).toBeNull();
      expect(parseTaxRatePercent('   ')).toBeNull();
    });

    it('should throw when the code is written as a fraction', () => {
      expect(() => parseTaxRatePercent('0.23')).toThrow(FractionalTaxRateNotationError);
      expect(() => parseTaxRatePercent('0.08')).toThrow(FractionalTaxRateNotationError);
      expect(() => parseTaxRatePercent('0.05')).toThrow(FractionalTaxRateNotationError);
    });

    it('should name the offending value when it throws', () => {
      expect(() => parseTaxRatePercent('0.23')).toThrow(/"0\.23"/);
    });
  });

  describe('taxRatePercentToFraction', () => {
    it('should divide by one hundred when the code is numeric', () => {
      expect(taxRatePercentToFraction('23')).toBeCloseTo(0.23, 10);
      expect(taxRatePercentToFraction('0')).toBe(0);
    });

    it('should return null when the code carries no percentage', () => {
      expect(taxRatePercentToFraction('zw')).toBeNull();
      expect(taxRatePercentToFraction('')).toBeNull();
    });
  });

  describe('isFractionalTaxRateNotation', () => {
    it('should report a value strictly between zero and one as fractional', () => {
      expect(isFractionalTaxRateNotation('0.23')).toBe(true);
      expect(isFractionalTaxRateNotation('0.5')).toBe(true);
    });

    it('should not report zero as fractional, since a zero rate is a real answer', () => {
      expect(isFractionalTaxRateNotation('0')).toBe(false);
      expect(isFractionalTaxRateNotation('0.00')).toBe(false);
    });

    it('should not report a whole percentage or an exemption code as fractional', () => {
      expect(isFractionalTaxRateNotation('1')).toBe(false);
      expect(isFractionalTaxRateNotation('23')).toBe(false);
      expect(isFractionalTaxRateNotation('zw')).toBe(false);
      expect(isFractionalTaxRateNotation('')).toBe(false);
    });
  });

  describe('assertPercentTaxRateNotation', () => {
    it('should return the trimmed code when the notation is valid', () => {
      expect(assertPercentTaxRateNotation(' 23 ')).toBe('23');
      expect(assertPercentTaxRateNotation('zw')).toBe('zw');
      expect(assertPercentTaxRateNotation('')).toBe('');
    });

    it('should throw when the notation is fractional', () => {
      expect(() => assertPercentTaxRateNotation('0.23')).toThrow(FractionalTaxRateNotationError);
    });
  });
});
