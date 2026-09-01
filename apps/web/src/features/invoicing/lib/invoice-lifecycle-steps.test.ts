import { describe, it, expect } from 'vitest';
import { resolveInvoiceLifecycleSteps } from './invoice-lifecycle-steps';
import type { InvoiceRecord } from '../api/invoicing.types';

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: 'conn_1',
    orderId: 'ord_1',
    providerType: 'ksef',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: null,
    providerInvoiceNumber: 'FV/1',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

describe('resolveInvoiceLifecycleSteps', () => {
  it('should render one step when the regime clears nothing', () => {
    const steps = resolveInvoiceLifecycleSteps(invoice({ regulatoryStatus: 'not-applicable' }));
    expect(steps).toEqual([{ id: 'issued', label: 'Issued', state: 'done', at: invoice().issuedAt }]);
  });

  it('should render an active awaiting-clearance step once submitted', () => {
    const steps = resolveInvoiceLifecycleSteps(invoice({ regulatoryStatus: 'submitted' }));
    expect(steps[1]).toEqual({
      id: 'clearance',
      label: 'Awaiting the authority',
      state: 'active',
      at: null,
    });
  });

  it('should render a done clearance step at the record`s own updatedAt when accepted', () => {
    const rec = invoice({ regulatoryStatus: 'accepted' });
    const steps = resolveInvoiceLifecycleSteps(rec);
    expect(steps[1]).toEqual({ id: 'clearance', label: 'Cleared', state: 'done', at: rec.updatedAt });
  });

  it('should render an error clearance step when the authority rejected it', () => {
    const rec = invoice({ regulatoryStatus: 'rejected' });
    const steps = resolveInvoiceLifecycleSteps(rec);
    expect(steps[1].state).toBe('error');
    expect(steps[1].label).toBe('Rejected by the authority');
  });
});
