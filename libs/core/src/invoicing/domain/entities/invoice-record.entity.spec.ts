/**
 * InvoiceRecord entity — unit tests
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import { InvoiceRecord } from './invoice-record.entity';
import type { InvoiceFailureMode, InvoiceStatus } from '../types/invoicing.types';

function makeRecord(
  status: InvoiceStatus,
  extras: { failureMode?: InvoiceFailureMode | null; leaseExpiresAt?: Date | null } = {},
): InvoiceRecord {
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
    extras.failureMode ?? null,
    extras.leaseExpiresAt ?? null,
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

  describe('isReattemptableFailure (#1200)', () => {
    it('is true ONLY for a terminal rejected failure', () => {
      expect(makeRecord('failed', { failureMode: 'rejected' }).isReattemptableFailure).toBe(true);
    });

    it('is false for an in-doubt failure (a document may already exist)', () => {
      expect(makeRecord('failed', { failureMode: 'in-doubt' }).isReattemptableFailure).toBe(false);
    });

    it('is false for a failed row with no recorded mode (fiscal-safe default)', () => {
      expect(makeRecord('failed', { failureMode: null }).isReattemptableFailure).toBe(false);
    });

    it('is false for non-failed statuses', () => {
      expect(makeRecord('pending').isReattemptableFailure).toBe(false);
      expect(makeRecord('issuing').isReattemptableFailure).toBe(false);
      expect(makeRecord('issued').isReattemptableFailure).toBe(false);
    });
  });

  describe('isLeaseLive (#1200)', () => {
    const now = new Date('2026-06-16T12:00:00.000Z');

    it('is true for an issuing row whose lease is in the future', () => {
      const live = makeRecord('issuing', { leaseExpiresAt: new Date(now.getTime() + 60_000) });
      expect(live.isLeaseLive(now)).toBe(true);
    });

    it('is false for an issuing row whose lease has expired', () => {
      const expired = makeRecord('issuing', { leaseExpiresAt: new Date(now.getTime() - 1) });
      expect(expired.isLeaseLive(now)).toBe(false);
    });

    it('is false for an issuing row with no lease, and for non-issuing statuses', () => {
      expect(makeRecord('issuing', { leaseExpiresAt: null }).isLeaseLive(now)).toBe(false);
      expect(
        makeRecord('pending', { leaseExpiresAt: new Date(now.getTime() + 60_000) }).isLeaseLive(now),
      ).toBe(false);
    });
  });
});
