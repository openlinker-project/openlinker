/**
 * Bank Accounts Reader capability guard — unit tests (#1303 follow-up)
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { type BankAccountsReader, isBankAccountsReader } from './bank-accounts-reader.capability';

const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isBankAccountsReader', () => {
  it('returns true when the adapter implements listBankAccounts', () => {
    const reader: InvoicingPort & BankAccountsReader = {
      ...base,
      listBankAccounts: jest.fn(),
    };
    expect(isBankAccountsReader(reader)).toBe(true);
  });

  it('returns false on a base InvoicingPort without bank-account discovery', () => {
    expect(isBankAccountsReader(base)).toBe(false);
  });
});
