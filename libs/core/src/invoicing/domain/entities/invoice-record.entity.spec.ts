/**
 * InvoiceRecord entity — unit tests
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import { InvoiceRecord } from './invoice-record.entity';
import type { InvoiceStatus } from '../types/invoicing.types';

function makeRecord(status: InvoiceStatus): InvoiceRecord {
  const now = new Date('2026-06-16T00:00:00.000Z');
  return new InvoiceRecord(
    'ol_invoice_1',
    'conn_1',
    'ol_order_1',
    'subiekt',
    'invoice',
    status,
    null,
    null,
    'not-applicable',
    null,
    'idem-1',
    null,
    null,
    null,
    now,
    now,
  );
}

describe('InvoiceRecord', () => {
  describe('isIssued', () => {
    it('returns true once issued', () => {
      expect(makeRecord('issued').isIssued).toBe(true);
    });

    it('returns false while pending or failed', () => {
      expect(makeRecord('pending').isIssued).toBe(false);
      expect(makeRecord('failed').isIssued).toBe(false);
    });
  });

  it('defaults regulatory fields to the not-applicable / null neutral state', () => {
    const record = makeRecord('issued');
    expect(record.regulatoryStatus).toBe('not-applicable');
    expect(record.clearanceReference).toBeNull();
  });
});
