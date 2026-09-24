import { deriveCorrectionFallbackKey } from './correction-fallback-key';
import type { CorrectionLine } from '../types/invoicing.types';

describe('deriveCorrectionFallbackKey', () => {
  const baseCmd = {
    connectionId: 'conn-1',
    orderId: 'order-1',
    originalProviderInvoiceId: 'PROV-123',
    documentType: 'corrected',
    reason: 'price adjustment',
    lines: [{ originalLineNumber: 1, newUnitPriceGross: 90 }] as CorrectionLine[],
  };

  it('is deterministic: identical input yields identical output', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).toBe(deriveCorrectionFallbackKey(baseCmd));
  });

  it('prefixes the digest so a fallback key is recognisable and never collides with an operator-supplied key by accident', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).toMatch(/^correction-fallback:[0-9a-f]{64}$/);
  });

  it('is line-order-independent: reordering the lines array does not change the key', () => {
    const twoLines: CorrectionLine[] = [
      { originalLineNumber: 1, newUnitPriceGross: 90 },
      { originalLineNumber: 2, newQuantity: 3 },
    ];
    const reversed = [...twoLines].reverse();

    expect(deriveCorrectionFallbackKey({ ...baseCmd, lines: twoLines })).toBe(
      deriveCorrectionFallbackKey({ ...baseCmd, lines: reversed }),
    );
  });

  it('differs when the connectionId differs', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).not.toBe(
      deriveCorrectionFallbackKey({ ...baseCmd, connectionId: 'conn-2' }),
    );
  });

  it('differs when the orderId differs', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).not.toBe(
      deriveCorrectionFallbackKey({ ...baseCmd, orderId: 'order-2' }),
    );
  });

  it('differs when originalProviderInvoiceId differs (a different document being corrected)', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).not.toBe(
      deriveCorrectionFallbackKey({ ...baseCmd, originalProviderInvoiceId: 'PROV-999' }),
    );
  });

  it('differs when the reason differs, so two materially different corrections never collapse into one record', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).not.toBe(
      deriveCorrectionFallbackKey({ ...baseCmd, reason: 'quantity adjustment' }),
    );
  });

  it('differs when the lines content differs — a genuinely different correction gets a distinct fallback key', () => {
    expect(deriveCorrectionFallbackKey(baseCmd)).not.toBe(
      deriveCorrectionFallbackKey({
        ...baseCmd,
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 50 }],
      }),
    );
  });

  it('treats an absent documentType the same as an explicit empty string (both join to the same segment)', () => {
    // Documented, acceptable: `documentType`/`reason` join with `''` for
    // BOTH "field omitted" and "field explicitly blank" — no caller in this
    // codebase distinguishes the two, and doing so would only widen the
    // fallback key's collision surface for no behavioural gain.
    const withUndefined = deriveCorrectionFallbackKey({
      ...baseCmd,
      documentType: undefined,
    });
    const withEmptyString = deriveCorrectionFallbackKey({
      ...baseCmd,
      documentType: '',
    });
    expect(withUndefined).toBe(withEmptyString);
  });
});
