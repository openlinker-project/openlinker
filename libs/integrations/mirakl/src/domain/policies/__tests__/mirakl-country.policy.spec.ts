/**
 * Mirakl Country Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { toAlpha2Country } from '../mirakl-country.policy';

describe('toAlpha2Country', () => {
  it('should map an alpha-3 code to alpha-2', () => {
    expect(toAlpha2Country('POL')).toBe('PL');
    expect(toAlpha2Country('deu')).toBe('DE');
  });

  it('should pass an alpha-2 code through', () => {
    expect(toAlpha2Country(' pl ')).toBe('PL');
  });

  it('should return an unknown alpha-3 code unchanged', () => {
    expect(toAlpha2Country('XYZ')).toBe('XYZ');
  });

  it.each([undefined, '', '  '])('should return undefined for %p', (code) => {
    expect(toAlpha2Country(code)).toBeUndefined();
  });
});
