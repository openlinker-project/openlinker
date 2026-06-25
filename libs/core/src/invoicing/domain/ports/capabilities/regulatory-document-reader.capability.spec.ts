/**
 * Regulatory Document Reader Capability — Guard Unit Tests
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import type { RegulatoryDocument } from './regulatory-document-reader.capability';
import { isRegulatoryDocumentReader } from './regulatory-document-reader.capability';

const baseInvoicingPort: InvoicingPort = {
  issueInvoice: jest.fn(),
  getInvoice: jest.fn(),
  upsertCustomer: jest.fn(),
  getSupportedDocumentTypes: jest.fn().mockReturnValue([]),
};

describe('isRegulatoryDocumentReader', () => {
  it('should return false when the adapter does not implement getRegulatoryDocument', () => {
    expect(isRegulatoryDocumentReader(baseInvoicingPort)).toBe(false);
  });

  it('should narrow to the reader when the adapter implements getRegulatoryDocument', () => {
    const document: RegulatoryDocument = { content: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' };
    const adapter: InvoicingPort = {
      ...baseInvoicingPort,
      getRegulatoryDocument: jest.fn().mockResolvedValue(document),
    } as InvoicingPort;

    expect(isRegulatoryDocumentReader(adapter)).toBe(true);
  });
});
