/**
 * Rate Source Resolution Tests
 *
 * @module libs/core/src/currency/domain/__tests__
 */
import { ReportingCurrencyUnsupportedError } from '../exceptions/reporting-currency.exception';
import { resolveRateSource } from '../rate-source-resolution';

describe('resolveRateSource', () => {
  it('should resolve PLN to nbp', () => {
    expect(resolveRateSource('PLN')).toBe('nbp');
  });

  it('should resolve EUR to ecb', () => {
    expect(resolveRateSource('EUR')).toBe('ecb');
  });

  it('should throw ReportingCurrencyUnsupportedError for a currency with no publisher', () => {
    expect(() => resolveRateSource('USD')).toThrow(ReportingCurrencyUnsupportedError);
  });

  it('should carry the supported set on the error so the operator is not left guessing', () => {
    try {
      resolveRateSource('USD');
      fail('expected resolveRateSource to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReportingCurrencyUnsupportedError);
      expect((error as ReportingCurrencyUnsupportedError).supportedCurrencies).toEqual([
        'PLN',
        'EUR',
      ]);
    }
  });

  it('should be case-sensitive - normalisation is the caller responsibility', () => {
    expect(() => resolveRateSource('pln')).toThrow(ReportingCurrencyUnsupportedError);
  });
});
