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

  it('should set isPrimary and triggerModel under invoicing', () => {
    const result = mergeSalesDocumentConfig({}, { isPrimary: true, triggerModel: 'auto-on-paid' });

    expect(result.invoicing).toEqual({ isPrimary: true, triggerModel: 'auto-on-paid' });
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
});
