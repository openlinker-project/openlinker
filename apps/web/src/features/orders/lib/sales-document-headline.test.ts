import { describe, it, expect } from 'vitest';
import { resolveInvoiceHeadline, resolveFiscalHeadline } from './sales-document-headline';
import type { InvoiceRecord } from '../../invoicing';
import type { FiscalRegistrationRecord } from '../../fiscalization';

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: 'conn_1',
    orderId: 'ord_1',
    providerType: 'ksef',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: null,
    providerInvoiceNumber: 'FV/1/2026',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

function fiscalRecord(overrides: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord {
  return {
    id: 'fr_1',
    connectionId: 'conn_2',
    orderId: 'ord_1',
    providerType: 'eparagony',
    idempotencyKey: 'key',
    status: 'registered',
    providerReference: null,
    documentReference: 'RC/1',
    signingIdentity: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    regimeExtras: null,
    artefacts: null,
    failureMode: null,
    failureReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveInvoiceHeadline', () => {
  it('should read Cleared with a done tone for an accepted clearance', () => {
    const model = resolveInvoiceHeadline(invoice({ regulatoryStatus: 'accepted' }), 'KSeF');
    expect(model).toEqual({ state: 'Cleared', tone: 'done', identity: 'FV/1/2026 · KSeF' });
  });

  it('should read Issued with a done tone when clearance does not apply', () => {
    const model = resolveInvoiceHeadline(invoice({ regulatoryStatus: 'not-applicable' }), 'Subiekt');
    expect(model.state).toBe('Issued');
    expect(model.tone).toBe('done');
  });

  it('should read Rejected by authority with an error tone', () => {
    const model = resolveInvoiceHeadline(invoice({ regulatoryStatus: 'rejected' }), 'KSeF');
    expect(model.state).toBe('Rejected by authority');
    expect(model.tone).toBe('error');
  });

  it('should split a failed issuance into Rejected (safe) vs Unconfirmed (in-doubt)', () => {
    expect(
      resolveInvoiceHeadline(invoice({ status: 'failed', failureMode: 'rejected' }), 'KSeF').state,
    ).toBe('Rejected');
    expect(
      resolveInvoiceHeadline(invoice({ status: 'failed', failureMode: 'in-doubt' }), 'KSeF').state,
    ).toBe('Unconfirmed');
  });
});

describe('resolveFiscalHeadline', () => {
  it('should read In progress elsewhere for a contended attempt with no elapsed data', () => {
    const model = resolveFiscalHeadline(null, undefined, 'eparagony', true);
    expect(model).toEqual({ state: 'In progress elsewhere', tone: 'progress', identity: null });
  });

  it('should read Registered with a done tone for a registered record', () => {
    const model = resolveFiscalHeadline(fiscalRecord(), undefined, 'eparagony', false);
    expect(model.state).toBe('Registered');
    expect(model.tone).toBe('done');
  });

  it('should read Stalled for a stalled progress with no record', () => {
    const model = resolveFiscalHeadline(null, 'stalled', 'eparagony', false);
    expect(model.state).toBe('Stalled');
    expect(model.tone).toBe('warning');
  });
});
