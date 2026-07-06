/**
 * Edit-connection inFakt seam — unit tests (#1310 review, finding 6)
 *
 * Covers the two previously-untested inFakt bank-account helpers on the edit
 * path: `readInfaktBankAccount` (hydration, including legacy numeric-id
 * coercion and shape rejection) and the `mergeStructuredIntoConfig`
 * `infaktBankAccount` clause (set / replace / null-clears-key / absent-noop).
 */
import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from './edit-connection.schema';
import { readInfaktBankAccount } from './EditConnectionForm';

describe('readInfaktBankAccount', () => {
  it('should hydrate a well-formed string-id snapshot', () => {
    expect(
      readInfaktBankAccount({
        bankAccount: { id: '42', accountNumber: '61 1140 2004', bankName: 'mBank' },
      }),
    ).toEqual({ id: '42', accountNumber: '61 1140 2004', bankName: 'mBank' });
  });

  it('should coerce a legacy numeric id to a string', () => {
    expect(
      readInfaktBankAccount({
        bankAccount: { id: 1, accountNumber: '61 1140 2004', bankName: 'mBank' },
      }),
    ).toEqual({ id: '1', accountNumber: '61 1140 2004', bankName: 'mBank' });
  });

  it('should return null when bankAccount is absent', () => {
    expect(readInfaktBankAccount({})).toBeNull();
  });

  it('should return null when bankAccount is not an object', () => {
    expect(readInfaktBankAccount({ bankAccount: 'nope' })).toBeNull();
  });

  it('should return null when accountNumber or bankName is missing', () => {
    expect(readInfaktBankAccount({ bankAccount: { id: '1', bankName: 'mBank' } })).toBeNull();
    expect(readInfaktBankAccount({ bankAccount: { id: '1', accountNumber: 'x' } })).toBeNull();
  });

  it('should return null when id is neither a string nor a number', () => {
    expect(
      readInfaktBankAccount({
        bankAccount: { id: {}, accountNumber: 'x', bankName: 'y' },
      }),
    ).toBeNull();
  });
});

describe('mergeStructuredIntoConfig — infaktBankAccount clause', () => {
  const snapshot = { id: '2', accountNumber: '12 1090 1014', bankName: 'Santander' };

  it('should set config.bankAccount from the structured patch', () => {
    expect(mergeStructuredIntoConfig({}, { infaktBankAccount: snapshot })).toEqual({
      bankAccount: snapshot,
    });
  });

  it('should replace an existing config.bankAccount', () => {
    const base = { bankAccount: { id: '1', accountNumber: 'old', bankName: 'mBank' } };
    expect(mergeStructuredIntoConfig(base, { infaktBankAccount: snapshot })).toEqual({
      bankAccount: snapshot,
    });
  });

  it('should delete config.bankAccount when the patch is null', () => {
    const base = { bankAccount: snapshot, defaultPaymentMethod: 'transfer' };
    expect(mergeStructuredIntoConfig(base, { infaktBankAccount: null })).toEqual({
      defaultPaymentMethod: 'transfer',
    });
  });

  it('should leave config.bankAccount untouched when the patch omits it', () => {
    const base = { bankAccount: snapshot };
    expect(mergeStructuredIntoConfig(base, {})).toEqual({ bankAccount: snapshot });
  });
});
