import { describe, expect, it } from 'vitest';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';
import { orderSalesDocumentCountries } from './order-sales-document-countries';

function makeSummary(country: string): SalesDocumentCountrySummary {
  return {
    country,
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
  };
}

describe('orderSalesDocumentCountries', () => {
  it('should sort non-rest-of-world countries alphabetically', () => {
    const ordered = orderSalesDocumentCountries([makeSummary('DE'), makeSummary('AT')]);
    expect(ordered.map((s) => s.country)).toEqual(['AT', 'DE']);
  });

  it('should always render ★ Rest of world last regardless of its position in the raw response', () => {
    const ordered = orderSalesDocumentCountries([
      makeSummary('*'),
      makeSummary('PL'),
      makeSummary('DE'),
    ]);
    expect(ordered.map((s) => s.country)).toEqual(['DE', 'PL', '*']);
  });

  it('should not invent a ★ Rest of world row when the response has none', () => {
    const ordered = orderSalesDocumentCountries([makeSummary('PL')]);
    expect(ordered.map((s) => s.country)).toEqual(['PL']);
  });

  it('should preserve the ★ Rest of world summary as returned, unmodified', () => {
    const configuredRestOfWorld: SalesDocumentCountrySummary = {
      ...makeSummary('*'),
      ruleCount: 2,
    };
    const ordered = orderSalesDocumentCountries([configuredRestOfWorld]);
    expect(ordered).toEqual([configuredRestOfWorld]);
  });

  it('should return an empty array for an empty response', () => {
    expect(orderSalesDocumentCountries([])).toEqual([]);
  });
});
