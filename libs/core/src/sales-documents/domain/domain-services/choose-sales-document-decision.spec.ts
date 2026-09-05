/**
 * chooseSalesDocumentDecision - unit spec (#2516, ADR-041 decision 5,
 * fallback retired by the "opcja b" decision)
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

  it('should return no-configuration-for-country as-is rather than falling back to the candidates', () => {
    const ruleDecision: SalesDocumentDecision = {
      kind: 'unresolved',
      reason: 'no-configuration-for-country',
    };

    expect(
      chooseSalesDocumentDecision({
        ruleDecision,
        candidates: [candidate({ connectionId: 'conn-only' })],
      }),
    ).toEqual(ruleDecision);
  });

  it('should report null when no rule-engine answer exists at all, regardless of candidates', () => {
    expect(
      chooseSalesDocumentDecision({
        ruleDecision: null,
        candidates: [candidate({ connectionId: 'conn-only' })],
      }),
    ).toBeNull();
  });

  it('should report null when there are no candidates and no rule-engine answer', () => {
    expect(chooseSalesDocumentDecision({ ruleDecision: null, candidates: [] })).toBeNull();
  });
});
