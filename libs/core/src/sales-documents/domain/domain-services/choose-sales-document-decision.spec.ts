/**
 * chooseSalesDocumentDecision - unit spec (#2516, ADR-041 decision 5)
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import type { SalesDocumentDecision } from '../types/sales-document-decision.types';
import { chooseSalesDocumentDecision } from './choose-sales-document-decision';
import type { SalesDocumentRoutingCandidate } from './resolve-sales-document-routing';

function candidate(overrides: Partial<SalesDocumentRoutingCandidate> = {}): SalesDocumentRoutingCandidate {
  return {
    connectionId: 'conn-1',
    documentKind: 'invoice',
    isPrimary: false,
    enabledCapabilities: ['Invoicing'],
    selfRoutesDocumentKind: false,
    ...overrides,
  };
}

describe('chooseSalesDocumentDecision', () => {
  it('should return a rule-engine route as-is without consulting the candidates', () => {
    const ruleDecision: SalesDocumentDecision = {
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-rules',
    };

    expect(
      chooseSalesDocumentDecision({
        ruleDecision,
        candidates: [candidate({ connectionId: 'conn-config' })],
      }),
    ).toEqual(ruleDecision);
  });

  it('should return a rule-engine unresolved reason other than no-configuration-for-country as-is', () => {
    const ruleDecision: SalesDocumentDecision = {
      kind: 'unresolved',
      reason: 'threshold-currency-mismatch',
    };

    expect(chooseSalesDocumentDecision({ ruleDecision, candidates: [candidate()] })).toEqual(
      ruleDecision,
    );
  });

  it('should fall back to the connection-configured resolver on no-configuration-for-country', () => {
    expect(
      chooseSalesDocumentDecision({
        ruleDecision: { kind: 'unresolved', reason: 'no-configuration-for-country' },
        candidates: [candidate({ connectionId: 'conn-only' })],
      }),
    ).toEqual({ kind: 'route', documentKind: 'invoice', connectionId: 'conn-only' });
  });

  it('should treat an absent rule-engine answer exactly like no-configuration-for-country', () => {
    expect(
      chooseSalesDocumentDecision({
        ruleDecision: null,
        candidates: [candidate({ connectionId: 'conn-only' })],
      }),
    ).toEqual({ kind: 'route', documentKind: 'invoice', connectionId: 'conn-only' });
  });

  it('should report null when no candidate carries a configured document kind', () => {
    expect(
      chooseSalesDocumentDecision({
        ruleDecision: null,
        candidates: [candidate({ documentKind: null })],
      }),
    ).toBeNull();
  });

  it('should report null when there are no candidates at all', () => {
    expect(chooseSalesDocumentDecision({ ruleDecision: null, candidates: [] })).toBeNull();
  });

  it('should report the ambiguity rather than picking one of several non-primary candidates', () => {
    expect(
      chooseSalesDocumentDecision({
        ruleDecision: null,
        candidates: [candidate({ connectionId: 'conn-a' }), candidate({ connectionId: 'conn-b' })],
      }),
    ).toEqual({ kind: 'unresolved', reason: 'ambiguous-connection-no-primary' });
  });
});
