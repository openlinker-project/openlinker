/**
 * Original-document assembly tests (#3540)
 *
 * @module libs/core/src/invoicing/domain/domain-services
 */
import type { InvoiceRecord } from '../entities/invoice-record.entity';
import type { IssuedLineSnapshot } from '../types/invoicing.types';
import { buildOriginalDocumentFromIssuedRecord } from './invoice-original-document.domain-service';

const snapshot = {
  buyer: {
    name: 'Jan',
    taxId: null,
    address: { line1: 'a', line2: null, city: 'c', postalCode: '1', countryIso2: 'PL' },
    type: 'consumer',
  },
  currency: 'PLN',
  lines: [{ name: 'Shirt', quantity: 1, unitPriceGross: 10, taxRate: '23' }],
} as unknown as IssuedLineSnapshot;

function record(overrides: Partial<Record<keyof InvoiceRecord, unknown>> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    documentType: 'invoice',
    clearanceReference: 'KSEF-1',
    providerInvoiceNumber: 'FV/1',
    issuedAt: new Date('2026-09-01T23:30:00.000Z'),
    ...overrides,
  } as unknown as InvoiceRecord;
}

describe('buildOriginalDocumentFromIssuedRecord (#3540)', () => {
  it('should assemble the document from the snapshot plus the record own identity', () => {
    const doc = buildOriginalDocumentFromIssuedRecord(record(), snapshot);

    expect(doc).toMatchObject({
      currency: 'PLN',
      documentType: 'invoice',
      clearanceReference: 'KSEF-1',
      documentNumber: 'FV/1',
      lines: snapshot.lines,
    });
    expect(doc.buyer.name).toBe('Jan');
  });

  it('should prefer the printed issue date over the UTC day of issuedAt', () => {
    const doc = buildOriginalDocumentFromIssuedRecord(record(), { ...snapshot, issueDate: '2026-09-02' });

    expect(doc.issueDate).toBe('2026-09-02');
  });

  it('should fall back to the UTC day of issuedAt when the snapshot has no printed date', () => {
    expect(buildOriginalDocumentFromIssuedRecord(record(), snapshot).issueDate).toBe('2026-09-01');
  });

  it('should default an empty document type to invoice', () => {
    expect(buildOriginalDocumentFromIssuedRecord(record({ documentType: '' }), snapshot).documentType).toBe(
      'invoice'
    );
  });

  it('should carry the optional snapshot parts only when present', () => {
    const bare = buildOriginalDocumentFromIssuedRecord(record(), snapshot);
    expect('saleDate' in bare).toBe(false);
    expect('annotations' in bare).toBe(false);
    expect('additionalParties' in bare).toBe(false);

    const rich = buildOriginalDocumentFromIssuedRecord(record(), { ...snapshot, saleDate: '2026-08-30' });
    expect(rich.saleDate).toBe('2026-08-30');
  });

  it('should refuse a record that has no document number or issue date rather than invent one', () => {
    expect(() =>
      buildOriginalDocumentFromIssuedRecord(record({ providerInvoiceNumber: null }), snapshot)
    ).toThrow(/not fully issued/);
    expect(() => buildOriginalDocumentFromIssuedRecord(record({ issuedAt: null }), snapshot)).toThrow(
      /not fully issued/
    );
  });
});
