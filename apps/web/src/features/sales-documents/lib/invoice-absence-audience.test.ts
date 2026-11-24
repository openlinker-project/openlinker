import { describe, expect, it } from 'vitest';
import { resolveInvoiceAbsenceAudience } from './invoice-absence-audience';

describe('resolveInvoiceAbsenceAudience', () => {
  it('should put an attention reason on the office list', () => {
    expect(resolveInvoiceAbsenceAudience('missing-tax-rate')).toBe('on-office-list');
  });

  it('should say nobody is told for a manual connection', () => {
    expect(resolveInvoiceAbsenceAudience('trigger-model-manual')).toBe('issued-on-request');
  });

  // #3583: a batched order is not on the office list (core leaves it out of the
  // attention count) - it is waiting for the next batch run.
  it('should say a batched order waits for the next batch, not that the office was told', () => {
    expect(resolveInvoiceAbsenceAudience('trigger-model-batched')).toBe('waiting-for-batch');
  });

  it('should say nobody is told for no reason or an unknown one', () => {
    expect(resolveInvoiceAbsenceAudience(null)).toBe('nobody-told');
    expect(resolveInvoiceAbsenceAudience('from-a-newer-backend')).toBe('nobody-told');
  });
});
