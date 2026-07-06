/**
 * Invoice Email Sender capability guard — unit tests (#1353)
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { type InvoiceEmailSender, isInvoiceEmailSender } from './invoice-email-sender.capability';

const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isInvoiceEmailSender', () => {
  it('returns true when the adapter implements sendByEmail', () => {
    const sender: InvoicingPort & InvoiceEmailSender = {
      ...base,
      sendByEmail: jest.fn(),
    };
    expect(isInvoiceEmailSender(sender)).toBe(true);
  });

  it('returns false on a base InvoicingPort without email delivery', () => {
    expect(isInvoiceEmailSender(base)).toBe(false);
  });
});
