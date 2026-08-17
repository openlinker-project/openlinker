/**
 * Sales-Document Kind Types — unit spec (#2155, ADR-041 decisions 4 + 10)
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { CoreSalesDocumentKindValues, readSalesDocumentRouting } from './sales-document-kind.types';

describe('CoreSalesDocumentKindValues (ADR-041 decision 10)', () => {
  it('should declare exactly the two well-known kinds the ADR specifies', () => {
    expect(CoreSalesDocumentKindValues).toEqual(['invoice', 'fiscal-receipt']);
  });
});

describe('readSalesDocumentRouting (ADR-041 decision 4)', () => {
  it('should read config.invoicing.isPrimary === true — the exact shape #2047 writes', () => {
    expect(readSalesDocumentRouting({ invoicing: { isPrimary: true } }).isPrimary).toBe(true);
  });

  it("should read config.invoicing.isPrimary === 'true' (hand-edited JSON) as primary", () => {
    expect(readSalesDocumentRouting({ invoicing: { isPrimary: 'true' } }).isPrimary).toBe(true);
  });

  it('should default isPrimary to false when unset, missing, or unrecognized', () => {
    expect(readSalesDocumentRouting({}).isPrimary).toBe(false);
    expect(readSalesDocumentRouting(undefined).isPrimary).toBe(false);
    expect(readSalesDocumentRouting(null).isPrimary).toBe(false);
    expect(readSalesDocumentRouting({ invoicing: { isPrimary: false } }).isPrimary).toBe(false);
    expect(readSalesDocumentRouting({ invoicing: { isPrimary: 'yes' } }).isPrimary).toBe(false);
    expect(readSalesDocumentRouting({ invoicing: {} }).isPrimary).toBe(false);
  });

  it('should read a non-empty config.salesDocument.documentKind verbatim (open-world)', () => {
    expect(
      readSalesDocumentRouting({ salesDocument: { documentKind: 'invoice' } }).documentKind,
    ).toBe('invoice');
    // Open-world: a regime-specific kind core has never seen is trusted verbatim.
    expect(
      readSalesDocumentRouting({ salesDocument: { documentKind: 'daily-aggregate-report' } })
        .documentKind,
    ).toBe('daily-aggregate-report');
  });

  it('should coerce a missing, blank, or non-string documentKind to null', () => {
    expect(readSalesDocumentRouting({}).documentKind).toBeNull();
    expect(readSalesDocumentRouting({ salesDocument: {} }).documentKind).toBeNull();
    expect(readSalesDocumentRouting({ salesDocument: { documentKind: '' } }).documentKind).toBeNull();
    expect(
      readSalesDocumentRouting({ salesDocument: { documentKind: '   ' } }).documentKind,
    ).toBeNull();
    expect(
      readSalesDocumentRouting({ salesDocument: { documentKind: 42 } }).documentKind,
    ).toBeNull();
  });

  it('should tolerate a non-object config without throwing', () => {
    expect(readSalesDocumentRouting('not-an-object')).toEqual({
      documentKind: null,
      isPrimary: false,
    });
    expect(readSalesDocumentRouting(42)).toEqual({ documentKind: null, isPrimary: false });
  });

  it('should read both fields independently from the same config object', () => {
    expect(
      readSalesDocumentRouting({
        invoicing: { isPrimary: true, triggerModel: 'auto-on-paid' },
        salesDocument: { documentKind: 'fiscal-receipt' },
      }),
    ).toEqual({ documentKind: 'fiscal-receipt', isPrimary: true });
  });
});
