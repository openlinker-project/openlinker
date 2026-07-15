/**
 * Document Number Consumer capability guard — unit tests (#1575)
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import {
  type DocumentNumberConsumer,
  isDocumentNumberConsumer,
} from './document-number-consumer.capability';

const base: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn(),
};

describe('isDocumentNumberConsumer', () => {
  it('returns true when the adapter declares consumesDocumentNumber', () => {
    const consumer: InvoicingPort & DocumentNumberConsumer = {
      ...base,
      consumesDocumentNumber: true,
      numberingTimeZone: 'Europe/Warsaw',
      maxDocumentNumberLength: 256,
    };
    expect(isDocumentNumberConsumer(consumer)).toBe(true);
  });

  it('returns false on a base InvoicingPort that numbers documents itself', () => {
    expect(isDocumentNumberConsumer(base)).toBe(false);
  });

  it('returns false when the discriminant is absent or falsy', () => {
    const notConsumer = { ...base, consumesDocumentNumber: false } as unknown as InvoicingPort;
    expect(isDocumentNumberConsumer(notConsumer)).toBe(false);
  });
});
