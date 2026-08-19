import { describe, expect, it } from 'vitest';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';
import { deriveSalesDocumentCountryStatus } from './derive-sales-document-country-status';

function makeSummary(overrides: Partial<SalesDocumentCountrySummary> = {}): SalesDocumentCountrySummary {
  return {
    country: 'DE',
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    ...overrides,
  };
}

describe('deriveSalesDocumentCountryStatus', () => {
  it('should report Configured (success, no dot) when ruleCount is greater than zero', () => {
    const badge = deriveSalesDocumentCountryStatus(makeSummary({ ruleCount: 3 }));
    expect(badge).toEqual({ status: 'configured', label: 'Configured', tone: 'success', withDot: false });
  });

  it('should report Configured when only the invoice default is set', () => {
    const badge = deriveSalesDocumentCountryStatus(
      makeSummary({ invoiceDefaultConnectionId: 'conn_1' }),
    );
    expect(badge.status).toBe('configured');
  });

  it('should report Configured when only the receipt default is set', () => {
    const badge = deriveSalesDocumentCountryStatus(
      makeSummary({ receiptDefaultConnectionId: 'conn_1' }),
    );
    expect(badge.status).toBe('configured');
  });

  it('should report "No document · by design" (neutral, no dot) when acknowledged and nothing else is configured', () => {
    const badge = deriveSalesDocumentCountryStatus(
      makeSummary({ acknowledgedNoDocumentAt: '2026-08-01T00:00:00.000Z' }),
    );
    expect(badge).toEqual({
      status: 'no-document-by-design',
      label: 'No document · by design',
      tone: 'neutral',
      withDot: false,
    });
  });

  it('should report Not configured (neutral, idle dot) when nothing is set and never acknowledged', () => {
    const badge = deriveSalesDocumentCountryStatus(makeSummary());
    expect(badge).toEqual({
      status: 'not-configured',
      label: 'Not configured',
      tone: 'neutral',
      withDot: true,
    });
  });

  it('should prefer Configured over an acknowledgment when both are present', () => {
    const badge = deriveSalesDocumentCountryStatus(
      makeSummary({ ruleCount: 1, acknowledgedNoDocumentAt: '2026-08-01T00:00:00.000Z' }),
    );
    expect(badge.status).toBe('configured');
  });
});
