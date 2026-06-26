/**
 * Unit tests for the fiscal-safety derive functions (#1240).
 *
 * These pure functions are the single source of truth for the retry gate and
 * display status mapping. The fiscal-safe DEFAULT — that an absent / unknown
 * `failureMode` collapses to `in-doubt` (never Retry) — is the highest-value
 * invariant in the invoicing redesign and is pinned explicitly here.
 */
import { describe, it, expect } from 'vitest';

import {
  canRetryInvoice,
  deriveInvoiceDisplayStatus,
  resolveFailureCopy,
} from './derive-invoice-display';
import type { InvoiceRecord } from '../api/invoicing.types';

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    orderId: 'order-1',
    connectionId: 'conn-1',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'pending',
    providerInvoiceId: null,
    providerInvoiceNumber: null,
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveInvoiceDisplayStatus
// ---------------------------------------------------------------------------

describe('deriveInvoiceDisplayStatus', () => {
  it('returns not-issued for null (no invoice record)', () => {
    expect(deriveInvoiceDisplayStatus(null)).toBe('not-issued');
  });

  it('returns pending for a pending row', () => {
    expect(deriveInvoiceDisplayStatus(makeRecord({ status: 'pending' }))).toBe('pending');
  });

  it('returns issuing for an issuing row', () => {
    expect(deriveInvoiceDisplayStatus(makeRecord({ status: 'issuing' }))).toBe('issuing');
  });

  it('returns issued for an issued row', () => {
    expect(deriveInvoiceDisplayStatus(makeRecord({ status: 'issued' }))).toBe('issued');
  });

  it('returns failed for failed + rejected (nothing was issued — safe to retry)', () => {
    expect(
      deriveInvoiceDisplayStatus(makeRecord({ status: 'failed', failureMode: 'rejected' })),
    ).toBe('failed');
  });

  it('returns in-doubt for failed + in-doubt (a document may exist)', () => {
    expect(
      deriveInvoiceDisplayStatus(makeRecord({ status: 'failed', failureMode: 'in-doubt' })),
    ).toBe('in-doubt');
  });

  // FISCAL-SAFE DEFAULT: absent / unknown failureMode ⇒ in-doubt, never failed
  it('returns in-doubt for failed + failureMode:null (fiscal-safe default)', () => {
    expect(
      deriveInvoiceDisplayStatus(makeRecord({ status: 'failed', failureMode: null })),
    ).toBe('in-doubt');
  });
});

// ---------------------------------------------------------------------------
// canRetryInvoice
// ---------------------------------------------------------------------------

describe('canRetryInvoice', () => {
  it('returns false for null (no invoice)', () => {
    expect(canRetryInvoice(null)).toBe(false);
  });

  it('returns false for pending', () => {
    expect(canRetryInvoice(makeRecord({ status: 'pending' }))).toBe(false);
  });

  it('returns false for issuing (live lease — in-flight)', () => {
    expect(canRetryInvoice(makeRecord({ status: 'issuing' }))).toBe(false);
  });

  it('returns false for issued (terminal success)', () => {
    expect(canRetryInvoice(makeRecord({ status: 'issued' }))).toBe(false);
  });

  it('returns true for failed + rejected (nothing was issued)', () => {
    expect(
      canRetryInvoice(makeRecord({ status: 'failed', failureMode: 'rejected' })),
    ).toBe(true);
  });

  it('returns false for failed + in-doubt (document may exist — no blind retry)', () => {
    expect(
      canRetryInvoice(makeRecord({ status: 'failed', failureMode: 'in-doubt' })),
    ).toBe(false);
  });

  // FISCAL-SAFE DEFAULT: absent failureMode must NEVER enable Retry
  it('returns false for failed + failureMode:null (fiscal-safe default — no blind retry)', () => {
    expect(
      canRetryInvoice(makeRecord({ status: 'failed', failureMode: null })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveFailureCopy
// ---------------------------------------------------------------------------

describe('resolveFailureCopy', () => {
  const t = (_key: string, fallback: string) => fallback;

  it('returns known failure code copy', () => {
    const copy = resolveFailureCopy(
      makeRecord({ status: 'failed', failureCode: 'buyer-tax-id-invalid' }),
      t,
    );
    expect(copy).toMatch(/tax ID/i);
  });

  it('returns in-doubt-safe generic copy for null failureCode', () => {
    const copy = resolveFailureCopy(makeRecord({ status: 'failed', failureCode: null }), t);
    expect(copy).toMatch(/confirm whether/i);
  });
});
