import { describe, expect, it } from 'vitest';
import { describeSalesDocumentMarketOutcome } from './sales-document-market-outcome-copy';
import type { SalesDocumentMarketOutcome } from '../api/sales-document-markets.types';

describe('describeSalesDocumentMarketOutcome', () => {
  it('should report an invoice route as issuing, needing no decision', () => {
    const outcome: SalesDocumentMarketOutcome = {
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn_1',
    };
    const copy = describeSalesDocumentMarketOutcome(outcome);
    expect(copy).toMatchObject({
      headline: 'Invoice',
      glyphKind: 'invoice',
      isIssuing: true,
      needsDecision: false,
      reasonShort: null,
    });
  });

  it('should report a fiscal-receipt route with its own glyph kind', () => {
    const outcome: SalesDocumentMarketOutcome = {
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn_1',
    };
    expect(describeSalesDocumentMarketOutcome(outcome).headline).toBe('Fiscal receipt');
  });

  it('should report an unrecognised document kind with no glyph rather than guessing', () => {
    const outcome: SalesDocumentMarketOutcome = {
      kind: 'route',
      documentKind: 'some-future-kind',
      connectionId: 'conn_1',
    };
    expect(describeSalesDocumentMarketOutcome(outcome).glyphKind).toBeNull();
  });

  it('should report an aggregate outcome as settled but not issuing', () => {
    const outcome: SalesDocumentMarketOutcome = { kind: 'aggregate', connectionId: 'conn_1' };
    const copy = describeSalesDocumentMarketOutcome(outcome);
    expect(copy.isIssuing).toBe(false);
    expect(copy.needsDecision).toBe(false);
  });

  it('should report an acknowledged market as a settled state needing no decision', () => {
    const copy = describeSalesDocumentMarketOutcome({ kind: 'acknowledged' });
    expect(copy.needsDecision).toBe(false);
    expect(copy.headline).toBe('No document, by choice');
  });

  it('should report an unresolved outcome as needing a decision with a reason', () => {
    const copy = describeSalesDocumentMarketOutcome({
      kind: 'unresolved',
      reason: 'ambiguous-connection-no-primary',
    });
    expect(copy.needsDecision).toBe(true);
    expect(copy.reasonShort).not.toBeNull();
  });

  it('should fall back to a generic reason when the reason is unrecognised', () => {
    const copy = describeSalesDocumentMarketOutcome({ kind: 'unresolved', reason: 'made-up' });
    expect(copy.needsDecision).toBe(true);
    expect(copy.reasonShort).toBe('Not set up');
  });
});
