/**
 * Payment Marker capability guard — unit tests (#1362)
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import { type PaymentMarker, isPaymentMarker } from './payment-marker.capability';

const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isPaymentMarker', () => {
  it('returns true when the adapter implements markPaid', () => {
    const marker: InvoicingPort & PaymentMarker = {
      ...base,
      markPaid: jest.fn(),
    };
    expect(isPaymentMarker(marker)).toBe(true);
  });

  it('returns false on a base InvoicingPort without outbound payment marking', () => {
    expect(isPaymentMarker(base)).toBe(false);
  });
});
