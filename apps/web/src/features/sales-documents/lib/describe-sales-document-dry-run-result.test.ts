import { describe, expect, it } from 'vitest';
import { describeSalesDocumentDryRunResult } from './describe-sales-document-dry-run-result';
import type { SalesDocumentDryRunResult } from '../api/sales-document-rules.types';

describe('describeSalesDocumentDryRunResult (#3191)', () => {
  const connectionName = (id: string): string | null => (id === 'conn-1' ? 'e-paragony Sandbox' : null);

  it('should attribute a match to the drafted candidate', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-1',
      decidedBy: 'candidate',
    };

    expect(describeSalesDocumentDryRunResult(result, connectionName)).toBe(
      'This order would get a fiscal receipt through e-paragony Sandbox - via the rule you are drafting.',
    );
  });

  it('should attribute a match to an already-saved rule when the candidate is not the winner', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn-1',
      decidedBy: 'saved-rule',
    };

    expect(describeSalesDocumentDryRunResult(result, connectionName)).toContain(
      'via an already-saved rule',
    );
  });

  it('should attribute a match to the tier-2 country default, never as an already-saved rule', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn-1',
      decidedBy: 'country-default',
    };

    const description = describeSalesDocumentDryRunResult(result, connectionName);
    expect(description).toContain('via the country default');
    expect(description).not.toContain('already-saved rule');
  });

  it('should describe an aggregate outcome without naming a document', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'aggregate',
      connectionId: 'conn-1',
    };

    expect(describeSalesDocumentDryRunResult(result, connectionName)).toBe(
      'This order would be collected into a periodic batch, not issued a document immediately.',
    );
  });

  it('should render a known unresolved reason using the shared reason-copy map', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'unresolved',
      reason: 'conflicting-rules-equal-priority',
    };

    expect(describeSalesDocumentDryRunResult(result, connectionName)).toContain('Two or more rules matched');
  });

  it('should never throw on an unrecognised reason and fall back to a neutral statement', () => {
    const result: SalesDocumentDryRunResult = {
      kind: 'unresolved',
      reason: 'some-future-reason-this-build-does-not-know',
    };

    expect(describeSalesDocumentDryRunResult(result, connectionName)).toBe(
      'This order would be held - nothing could decide a document for it.',
    );
  });
});
