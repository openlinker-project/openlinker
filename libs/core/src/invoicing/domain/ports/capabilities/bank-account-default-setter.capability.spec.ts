/**
 * Bank Account Default Setter capability guard — unit tests (#1303 follow-up)
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import {
  type BankAccountDefaultSetter,
  isBankAccountDefaultSetter,
} from './bank-account-default-setter.capability';

const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isBankAccountDefaultSetter', () => {
  it('returns true when the adapter implements setDefaultBankAccount and the inherited listBankAccounts', () => {
    const setter: InvoicingPort & BankAccountDefaultSetter = {
      ...base,
      listBankAccounts: jest.fn(),
      setDefaultBankAccount: jest.fn(),
    };
    expect(isBankAccountDefaultSetter(setter)).toBe(true);
  });

  it('returns false when the adapter exposes setDefaultBankAccount without the inherited listBankAccounts', () => {
    const setterOnly = {
      ...base,
      setDefaultBankAccount: jest.fn(),
    };
    expect(isBankAccountDefaultSetter(setterOnly)).toBe(false);
  });

  it('returns false on a base InvoicingPort without default-setting support', () => {
    expect(isBankAccountDefaultSetter(base)).toBe(false);
  });
});
