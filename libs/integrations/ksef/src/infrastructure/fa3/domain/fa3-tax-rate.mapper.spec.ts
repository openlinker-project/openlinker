/**
 * FA(3) Tax-Rate Mapper — Unit Specs
 *
 * Pins the complete `P_12` mapping contract: all 9 values resolve and an
 * unknown / empty code throws `UnmappedTaxRateException`.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnmappedTaxRateException } from '../../../domain/exceptions/fa3-builder.exception';
import type { Fa3P12Value } from './fa3-schema.types';
import { resolveP12 } from './fa3-tax-rate.mapper';

describe('resolveP12', () => {
  const cases: Array<[string, Fa3P12Value]> = [
    ['23', '23'],
    ['8', '8'],
    ['5', '5'],
    ['0-kr', '0 KR'],
    ['0-wdt', '0 WDT'],
    ['0-ex', '0 EX'],
    ['exempt', 'zw'],
    ['reverse-charge', 'oo'],
    ['not-applicable', 'np'],
  ];

  it.each(cases)('should map neutral "%s" to P_12 "%s"', (neutral, expected) => {
    expect(resolveP12(neutral)).toBe(expected);
  });

  it('should throw UnmappedTaxRateException on an unknown rate', () => {
    expect(() => resolveP12('not-a-rate')).toThrow(UnmappedTaxRateException);
  });

  it('should throw UnmappedTaxRateException on an empty rate', () => {
    expect(() => resolveP12('')).toThrow(UnmappedTaxRateException);
  });
});
