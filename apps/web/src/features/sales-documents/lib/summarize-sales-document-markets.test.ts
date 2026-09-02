import { describe, expect, it } from 'vitest';
import { summarizeSalesDocumentMarkets } from './summarize-sales-document-markets';
import type { SalesDocumentMarketRow } from '../api/sales-document-markets.types';

function row(overrides: Partial<SalesDocumentMarketRow> = {}): SalesDocumentMarketRow {
  return {
    country: 'DE',
    orderCount: null,
    hasTemplate: false,
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    outcome: { kind: 'route', documentKind: 'invoice', connectionId: 'conn_1' },
    ...overrides,
  };
}

describe('summarizeSalesDocumentMarkets', () => {
  it('should return null for an empty row set, leaving the empty state to own the message', () => {
    expect(summarizeSalesDocumentMarkets([])).toBeNull();
  });

  it('should return an all-set sentence when every market issues', () => {
    const summary = summarizeSalesDocumentMarkets([row({ country: 'DE' }), row({ country: 'AT' })]);
    expect(summary?.tone).toBe('all-set');
    expect(summary?.sentence).toContain('issuing');
  });

  it('should read a fresh install receiving orders as not-set-up, never broken', () => {
    const blocked = row({
      country: 'PL',
      orderCount: 4,
      outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
    });
    const summary = summarizeSalesDocumentMarkets([blocked]);
    expect(summary?.tone).toBe('fresh-install');
    expect(summary?.sentence).toContain('not been set up yet');
    expect(summary?.sentence).toContain('Nothing is lost');
  });

  it('should read a partly-configured instance with a blocked market as needing attention', () => {
    const configured = row({
      country: 'DE',
      ruleCount: 1,
      outcome: { kind: 'route', documentKind: 'invoice', connectionId: 'conn_1' },
    });
    const blocked = row({
      country: 'AT',
      orderCount: 2,
      outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
    });
    const summary = summarizeSalesDocumentMarkets([configured, blocked]);
    expect(summary?.tone).toBe('attention');
    expect(summary?.sentence).toContain('AT');
    expect(summary?.sentence).toContain('Nothing is lost');
  });

  it('should name every blocked market up to the cap and count the rest', () => {
    const configured = row({ country: 'DE', ruleCount: 1 });
    const blockedRows = ['A1', 'A2', 'A3', 'A4'].map((country) =>
      row({ country, orderCount: 1, outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' } }),
    );
    const summary = summarizeSalesDocumentMarkets([configured, ...blockedRows]);
    expect(summary?.sentence).toContain('A1, A2, A3, and 1 more');
  });
});
