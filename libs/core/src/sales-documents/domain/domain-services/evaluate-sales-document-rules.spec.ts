/**
 * evaluateSalesDocumentRules — unit spec (#2170, ADR-041 decision 5, narrowed)
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import {
  evaluateSalesDocumentRules,
  type SalesDocumentRuleEngineInput,
} from './evaluate-sales-document-rules';
import type {
  SalesDocumentOrderFacts,
  SalesDocumentRuleFact,
  SalesDocumentThresholdFact,
} from '../types/sales-document-order-facts.types';

const NOW = new Date('2027-06-01T00:00:00.000Z');

function order(overrides: Partial<SalesDocumentOrderFacts> = {}): SalesDocumentOrderFacts {
  return {
    country: 'PL',
    totalGross: 100,
    currency: 'PLN',
    taxTreatment: 'inclusive',
    buyerHasTaxId: false,
    ...overrides,
  };
}

function rule(overrides: Partial<SalesDocumentRuleFact> = {}): SalesDocumentRuleFact {
  return {
    id: 'rule-1',
    conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn-eparagony',
    effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    effectiveTo: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<SalesDocumentRuleEngineInput> = {}): SalesDocumentRuleEngineInput {
  return {
    order: order(),
    countryRules: [],
    countryDefaults: [],
    restOfWorldRules: [],
    restOfWorldDefaults: [],
    thresholds: [],
    now: NOW,
    ...overrides,
  };
}

describe('evaluateSalesDocumentRules (#2170)', () => {
  describe('tier 1 — rule match', () => {
    it('should route to the single matching rule for the order country', () => {
      const input = baseInput({ countryRules: [rule()] });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-eparagony',
      });
    });

    it('should evaluate multi-condition rules with AND semantics', () => {
      const threshold: SalesDocumentThresholdFact = {
        ref: 'pl-simplified-invoice-2026',
        amount: 450,
        currency: 'PLN',
        comparisonOp: 'gte',
      };
      const highValueRule = rule({
        id: 'rule-high',
        conditions: [
          { field: 'buyerHasTaxId', op: 'eq', value: true },
          { field: 'orderTotalGross', op: 'gte', thresholdRef: 'pl-simplified-invoice-2026' },
        ],
        documentKind: 'invoice',
        connectionId: 'conn-infakt',
      });
      const input = baseInput({
        order: order({ buyerHasTaxId: true, totalGross: 500 }),
        countryRules: [highValueRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-infakt',
      });
    });

    it('should not match a rule outside its effective date range', () => {
      const expired = rule({ effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2026-12-31') });
      const input = baseInput({ countryRules: [expired], now: new Date('2027-01-01') });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'no-matching-rule',
      });
    });

    it('should resolve unresolved/conflicting-rules-equal-priority when two DIFFERENT rules both match (no priority field)', () => {
      const ruleA = rule({ id: 'a', conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }] });
      const ruleB = rule({
        id: 'b',
        conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }],
        connectionId: 'conn-other',
      });
      const input = baseInput({ countryRules: [ruleA, ruleB] });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'conflicting-rules-equal-priority',
      });
    });
  });

  describe('tier 2 — country default', () => {
    it('should fall back to the single country default when no rule matches', () => {
      const nonMatching = rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] });
      const input = baseInput({
        countryRules: [nonMatching],
        countryDefaults: [{ documentKind: 'invoice', connectionId: 'conn-infakt' }],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-infakt',
      });
    });

    it('should resolve unresolved/ambiguous-connection-no-primary when both per-kind defaults are configured and no rule discriminates', () => {
      const input = baseInput({
        countryDefaults: [
          { documentKind: 'invoice', connectionId: 'conn-infakt' },
          { documentKind: 'fiscal-receipt', connectionId: 'conn-eparagony' },
        ],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'ambiguous-connection-no-primary',
      });
    });
  });

  describe('tier 3 — fall through to Rest of world', () => {
    it("should fall through to '★ Rest of world' when the order's own country has no rules and no defaults", () => {
      const input = baseInput({
        order: order({ country: 'DE' }),
        restOfWorldRules: [rule({ connectionId: 'conn-row' })],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-row',
      });
    });

    it('should NOT fall through when the country has ANY configuration, even if that configuration failed to resolve', () => {
      const nonMatching = rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] });
      const input = baseInput({
        countryRules: [nonMatching],
        restOfWorldRules: [rule({ connectionId: 'conn-row' })],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'no-matching-rule',
      });
    });
  });

  describe('tier 4 — nothing configured anywhere', () => {
    it('should resolve unresolved/no-configuration-for-country when neither the country nor Rest of world is configured', () => {
      const input = baseInput();
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'no-configuration-for-country',
      });
    });
  });

  describe('currency and net-priced safety (never a silent FX conversion)', () => {
    const threshold: SalesDocumentThresholdFact = {
      ref: 'pl-simplified-invoice-2026',
      amount: 450,
      currency: 'PLN',
      comparisonOp: 'lt',
    };
    const amountRule = rule({
      conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' }],
    });

    it('should resolve unresolved/threshold-currency-mismatch when the order currency differs from the threshold currency', () => {
      const input = baseInput({
        order: order({ currency: 'EUR' }),
        countryRules: [amountRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'threshold-currency-mismatch',
      });
    });

    it('should resolve unresolved/net-priced-order for an exclusive (net) total, never guessing the gross amount', () => {
      const input = baseInput({
        order: order({ taxTreatment: 'exclusive' }),
        countryRules: [amountRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'net-priced-order',
      });
    });

    it('should match cleanly when currency and tax treatment both check out', () => {
      const input = baseInput({
        order: order({ totalGross: 100, currency: 'PLN', taxTreatment: 'inclusive' }),
        countryRules: [amountRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-eparagony',
      });
    });
  });
});
