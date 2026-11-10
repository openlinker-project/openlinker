/**
 * Sales-document block detail tests (#3866)
 *
 * The block's elaboration is phrased from its params; a block without params
 * keeps the backend's English detail, but only under the "not translated" label.
 */
import { describe, expect, it } from 'vitest';
import { describeSalesDocumentBlockDetail } from './sales-document-block-detail';

describe('describeSalesDocumentBlockDetail', () => {
  it('should phrase an ambiguity with no primary from the counts', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
        detail: '2 invoicing connections, none marked primary',
        params: { eligibleCount: 2, primaryCount: 0, poolKind: 'invoice' },
      }),
    ).toBe('Connections that could issue it: 2. None is marked primary.');
  });

  it('should name the rule, the connection and why it cannot issue', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'unresolved-routing',
        unresolvedReason: 'routed-connection-unavailable',
        detail: null,
        params: { connectionId: 'conn-1', ruleId: 'rule-1', connectionState: 'disabled' },
      }),
    ).toBe('Rule rule-1 sends this order to connection conn-1. It is disabled.');
  });

  it('should name the documents a connection is not set up for, never the capability', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'unresolved-routing',
        unresolvedReason: 'routed-connection-unavailable',
        detail: null,
        params: {
          connectionId: 'conn-1',
          connectionState: 'missing-capability',
          missingCapabilities: ['Invoicing', 'Fiscalization'],
        },
      }),
    ).toBe('Routing sends this order to connection conn-1. It is not set up to issue invoices or receipts.');
  });

  it('should count the lines without a tax rate', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'missing-tax-rate',
        unresolvedReason: null,
        detail: '1 of 3 lines carry no tax rate',
        params: { taxRateScope: 'lines', lineCount: 1, totalLines: 3 },
      }),
    ).toBe('Lines without a tax rate: 1 of 3.');
  });

  it('should show the English detail under the not-translated label when there are no params', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'line-total-mismatch',
        unresolvedReason: null,
        detail: 'lines sum to 10.00, total is 12.00',
        params: null,
      }),
    ).toBe('Technical details (not translated): lines sum to 10.00, total is 12.00');
  });

  it('should return null when there is nothing to add', () => {
    expect(
      describeSalesDocumentBlockDetail({
        reason: 'trigger-model-manual',
        unresolvedReason: null,
        detail: null,
        params: null,
      }),
    ).toBeNull();
  });
});
