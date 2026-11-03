/**
 * Regulatory Document Reader Capability — Guard Unit Tests
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { InvoicingPort } from '../invoicing.port';
import type {
  RegulatoryDocument,
  RegulatoryDocumentReader,
} from './regulatory-document-reader.capability';
import {
  isRegulatoryDocumentReader,
  supportsRegulatoryDocumentKind,
} from './regulatory-document-reader.capability';

const record = {} as InvoiceRecord;

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

  it('should let a narrowed reader be called without a kind (kind defaults to confirmation)', async () => {
    const document: RegulatoryDocument = { content: new Uint8Array([9]), contentType: 'application/xml' };
    const getRegulatoryDocument = jest.fn().mockResolvedValue(document);
    const adapter: InvoicingPort = { ...baseInvoicingPort, getRegulatoryDocument } as InvoicingPort;

    if (!isRegulatoryDocumentReader(adapter)) {
      throw new Error('guard should have narrowed');
    }
    // No `kind` argument — the optional param defaults to `confirmation` at the implementation.
    await expect(adapter.getRegulatoryDocument(record)).resolves.toBe(document);
    expect(getRegulatoryDocument).toHaveBeenCalledWith(record);
  });
});

describe('supportsRegulatoryDocumentKind (#3648)', () => {
  const withHint = (
    kinds: readonly ('confirmation' | 'rendered' | 'source')[],
  ): InvoicingPort & RegulatoryDocumentReader =>
    ({
      ...baseInvoicingPort,
      getRegulatoryDocument: jest.fn(),
      supportedRegulatoryDocumentKinds: () => kinds,
    }) as InvoicingPort & RegulatoryDocumentReader;

  it('should assume every kind when the adapter declares no hint', () => {
    const legacy = { ...baseInvoicingPort, getRegulatoryDocument: jest.fn() } as InvoicingPort &
      RegulatoryDocumentReader;

    expect(supportsRegulatoryDocumentKind(legacy, 'rendered')).toBe(true);
  });

  it('should refuse a kind the adapter does not list', () => {
    expect(supportsRegulatoryDocumentKind(withHint(['confirmation']), 'rendered')).toBe(false);
  });

  it('should accept a kind the adapter lists', () => {
    expect(supportsRegulatoryDocumentKind(withHint(['confirmation', 'rendered']), 'rendered')).toBe(
      true,
    );
  });
});
