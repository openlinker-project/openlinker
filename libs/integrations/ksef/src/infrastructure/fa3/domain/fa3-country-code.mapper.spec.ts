/**
 * FA(3) Country Code Mapper - Unit Specs
 *
 * Pins the ISO-3166 alpha-2 -> `KodKraju` resolution: enumeration members
 * pass (case/whitespace-normalised, so lowercase source-adapter codes like
 * "pl" become "PL"); anything outside the `TKodKraju` closed enumeration
 * throws `UnsupportedCountryCodeException` naming the offending value.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnsupportedCountryCodeException } from '../../../domain/exceptions/fa3-builder.exception';
import { resolveKodKraju } from './fa3-country-code.mapper';

describe('resolveKodKraju', () => {
  it('should pass through an already-uppercase enumeration member', () => {
    expect(resolveKodKraju('PL')).toBe('PL');
    expect(resolveKodKraju('DE')).toBe('DE');
  });

  it('should uppercase a lowercase code when the normalised value is an enumeration member', () => {
    expect(resolveKodKraju('pl')).toBe('PL');
  });

  it('should trim surrounding whitespace when normalising', () => {
    expect(resolveKodKraju(' PL ')).toBe('PL');
  });

  it('should throw UnsupportedCountryCodeException when the code is outside the enumeration', () => {
    expect(() => resolveKodKraju('xx')).toThrow(UnsupportedCountryCodeException);
    expect(() => resolveKodKraju('ZZ')).toThrow(UnsupportedCountryCodeException);
  });

  it('should throw UnsupportedCountryCodeException for an empty/garbage value', () => {
    expect(() => resolveKodKraju('')).toThrow(UnsupportedCountryCodeException);
    expect(() => resolveKodKraju('not-a-country')).toThrow(UnsupportedCountryCodeException);
  });

  it('should name the offending value in the thrown error message', () => {
    expect(() => resolveKodKraju('xx')).toThrow(
      'No FA(3) KodKraju mapping for country code: "xx"',
    );
  });
});
