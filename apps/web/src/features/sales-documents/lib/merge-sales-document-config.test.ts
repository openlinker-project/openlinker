import { describe, expect, it } from 'vitest';
import { mergeSalesDocumentConfig } from './merge-sales-document-config';

describe('mergeSalesDocumentConfig', () => {
  it('should preserve unrelated top-level config keys', () => {
    const result = mergeSalesDocumentConfig(
      { baseUrl: 'https://example.com', stockSafetyBuffer: 5 },
      { isPrimary: true },
    );

    expect(result.baseUrl).toBe('https://example.com');
    expect(result.stockSafetyBuffer).toBe(5);
  });

  it('should preserve sibling keys already nested under invoicing', () => {
    const result = mergeSalesDocumentConfig(
      { invoicing: { shippingLineName: 'Shipping' } },
      { isPrimary: true },
    );

    expect(result.invoicing).toEqual({ shippingLineName: 'Shipping', isPrimary: true });
  });

  it('should set isPrimary under invoicing and the trigger model under its kind', () => {
    const result = mergeSalesDocumentConfig(
      {},
      { isPrimary: true, triggerModel: { kind: 'invoice', value: 'auto-on-paid' } },
    );

    expect(result.invoicing).toEqual({ isPrimary: true });
    expect(result.salesDocument).toEqual({ triggerModels: { invoice: 'auto-on-paid' } });
  });

  // #3582: one kind's write leaves the other kind's entry, the documentKind and
  // the legacy key (still the fallback for an unset kind) alone.
  it('should write one kind without touching the other kind or the legacy key', () => {
    const result = mergeSalesDocumentConfig(
      {
        invoicing: { isPrimary: true, triggerModel: 'manual' },
        salesDocument: { documentKind: 'both', triggerModels: { invoice: 'batched' } },
      },
      { triggerModel: { kind: 'fiscal-receipt', value: 'auto-on-paid' } },
    );

    expect(result.invoicing).toEqual({ isPrimary: true, triggerModel: 'manual' });
    expect(result.salesDocument).toEqual({
      documentKind: 'both',
      triggerModels: { invoice: 'batched', 'fiscal-receipt': 'auto-on-paid' },
    });
  });

  it('should write a non-empty documentKind under salesDocument', () => {
    const result = mergeSalesDocumentConfig({}, { documentKind: 'invoice' });

    expect(result.salesDocument).toEqual({ documentKind: 'invoice' });
  });

  it('should delete documentKind (not write an empty string) when patched to ""', () => {
    const result = mergeSalesDocumentConfig(
      { salesDocument: { documentKind: 'invoice' } },
      { documentKind: '' },
    );

    expect(result.salesDocument).toEqual({});
  });

  it('should leave a field untouched when the patch omits it', () => {
    const result = mergeSalesDocumentConfig(
      { invoicing: { isPrimary: true, triggerModel: 'manual' } },
      { isPrimary: false },
    );

    expect(result.invoicing).toEqual({ isPrimary: false, triggerModel: 'manual' });
  });

  it("should write one kind's batch schedule and keep the other kind's (#3584)", () => {
    const receipt = {
      frequency: 'daily' as const,
      time: '20:00',
      timeZone: 'Europe/Warsaw',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
    };
    const invoice = {
      frequency: 'month-end' as const,
      timeZone: 'Europe/Warsaw',
      effectiveFrom: '2026-11-02T00:00:00.000Z',
    };

    const result = mergeSalesDocumentConfig(
      { salesDocument: { batchSchedules: { 'fiscal-receipt': receipt } } },
      { batchSchedule: { kind: 'invoice', value: invoice } },
    );

    expect(result.salesDocument).toEqual({
      batchSchedules: { 'fiscal-receipt': receipt, invoice },
    });
  });

  it('should remove a batch schedule patched to null', () => {
    const result = mergeSalesDocumentConfig(
      { salesDocument: { batchSchedules: { invoice: { frequency: 'daily' } } } },
      { batchSchedule: { kind: 'invoice', value: null } },
    );

    expect(result.salesDocument).toEqual({ batchSchedules: {} });
  });
});
