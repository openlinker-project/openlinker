import { describe, expect, it } from 'vitest';
import { orderSalesDocumentMarkets } from './order-sales-document-markets';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import type { SalesDocumentMarketRow } from '../api/sales-document-markets.types';

function row(country: string, outcomeKind: SalesDocumentMarketRow['outcome']['kind']): SalesDocumentMarketRow {
  return {
    country,
    orderCount: null,
    hasTemplate: false,
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    outcome: outcomeKind === 'unresolved' ? { kind: 'unresolved', reason: 'x' } : { kind: outcomeKind },
  };
}

describe('orderSalesDocumentMarkets', () => {
  it('should sort a market needing a decision above a settled one', () => {
    const result = orderSalesDocumentMarkets([row('DE', 'route'), row('AT', 'unresolved')]);
    expect(result.map((r) => r.country)).toEqual(['AT', 'DE']);
  });

  it('should sort alphabetically within the same decision group', () => {
    const result = orderSalesDocumentMarkets([
      row('PL', 'unresolved'),
      row('AT', 'unresolved'),
      row('DE', 'route'),
      row('BE', 'route'),
    ]);
    expect(result.map((r) => r.country)).toEqual(['AT', 'PL', 'BE', 'DE']);
  });

  it('should always place Rest of world last, regardless of its outcome', () => {
    const result = orderSalesDocumentMarkets([
      row(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY, 'unresolved'),
      row('DE', 'route'),
    ]);
    expect(result.map((r) => r.country)).toEqual(['DE', SALES_DOCUMENT_REST_OF_WORLD_COUNTRY]);
  });
});
