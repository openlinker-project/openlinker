/**
 * resolveAmazonTaxCode tests (#4182)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { resolveAmazonTaxCode } from '../amazon-tax-code.policy';

const RATES = { A_GEN_STANDARD: '23', A_BOOKS_GEN: '5', A_FOOD_GEN: '8' };

describe('resolveAmazonTaxCode', () => {
  it('should give the code the rate is mapped to', () => {
    expect(resolveAmazonTaxCode('5', RATES)).toEqual({ kind: 'resolved', code: 'A_BOOKS_GEN' });
  });

  it('should treat "23.00" and "23" as the same rate', () => {
    expect(resolveAmazonTaxCode('23.00', RATES)).toEqual({ kind: 'resolved', code: 'A_GEN_STANDARD' });
  });

  it('should answer nothing when no code is mapped to the rate', () => {
    expect(resolveAmazonTaxCode('0', RATES)).toEqual({ kind: 'none', reason: 'not-mapped' });
    expect(resolveAmazonTaxCode('23', undefined)).toEqual({ kind: 'none', reason: 'not-mapped' });
  });

  it('should refuse to pick when two codes map to the rate', () => {
    expect(resolveAmazonTaxCode('23', { ...RATES, A_GEN_TAX: '23' })).toEqual({
      kind: 'none',
      reason: 'ambiguous',
      codes: ['A_GEN_STANDARD', 'A_GEN_TAX'],
    });
  });

  it('should answer nothing without a rate', () => {
    expect(resolveAmazonTaxCode(undefined, RATES)).toEqual({ kind: 'none', reason: 'no-rate' });
    expect(resolveAmazonTaxCode('  ', RATES)).toEqual({ kind: 'none', reason: 'no-rate' });
  });

  it('should compare exemption codes as text', () => {
    expect(resolveAmazonTaxCode('ZW', { A_EXEMPT: 'zw' })).toEqual({ kind: 'resolved', code: 'A_EXEMPT' });
  });
});
