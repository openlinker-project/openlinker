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

    // Review finding 11: the type's own doc comment says a MISSING taxTreatment
    // resolves the same as `exclusive`, but the evaluator previously only
    // checked `=== 'exclusive'` and silently treated `undefined` as
    // gross-comparable — letting an order with genuinely unknown tax
    // treatment match an amount-threshold rule it shouldn't.
    it('should resolve unresolved/net-priced-order when taxTreatment is UNDEFINED, not just when it is exclusive', () => {
      const input = baseInput({
        order: order({ taxTreatment: undefined }),
        countryRules: [amountRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'net-priced-order',
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

    // Review finding 3: a later rule's own data problem must never discard
    // an already-found clean match from an earlier rule in the same scope.
    it('should still route on a clean match even when a LATER rule in the scope has a currency mismatch', () => {
      const cleanRule = rule({ id: 'clean', conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }] });
      const brokenRule = rule({
        id: 'broken',
        conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' }],
        connectionId: 'conn-other',
      });
      const input = baseInput({
        order: order({ currency: 'EUR' }),
        countryRules: [cleanRule, brokenRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-eparagony',
      });
    });

    it('should still route on a clean match even when an EARLIER rule in the scope has a currency mismatch', () => {
      const brokenRule = rule({
        id: 'broken',
        conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' }],
        connectionId: 'conn-other',
      });
      const cleanRule = rule({ id: 'clean', conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }] });
      const input = baseInput({
        order: order({ currency: 'EUR' }),
        countryRules: [brokenRule, cleanRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'fiscal-receipt',
        connectionId: 'conn-eparagony',
      });
    });

    it('should still resolve the data problem when NOTHING in the scope matches cleanly', () => {
      const brokenRule = rule({
        id: 'broken',
        conditions: [{ field: 'orderTotalGross', op: 'lt', thresholdRef: 'pl-simplified-invoice-2026' }],
      });
      const nonMatching = rule({ id: 'other', conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] });
      const input = baseInput({
        order: order({ currency: 'EUR' }),
        countryRules: [nonMatching, brokenRule],
        thresholds: [threshold],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'threshold-currency-mismatch',
      });
    });
  });

  // #2173 (ADR-041 decision 5's own blocked prerequisite): the `Order`
  // contract carries no buyer-tax-id field yet, so every real-order caller
  // (`AutoIssueTriggerService`'s order-facts mapper) supplies `undefined`,
  // never `false`. These pin the evaluator's EXISTING handling of that
  // (unchanged by #2173 — the issue only feeds it real data): `undefined`
  // matches neither `true` nor `false`, so a `buyerHasTaxId` condition never
  // matches, never throws, and never silently coerces to a guess.
  describe('an unknown buyerHasTaxId (undefined) never matches (#2173)', () => {
    it('should NOT match a buyerHasTaxId: true condition when the fact is undefined', () => {
      const input = baseInput({
        order: order({ buyerHasTaxId: undefined }),
        countryRules: [rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] })],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'no-matching-rule',
      });
    });

    it('should NOT match a buyerHasTaxId: false condition when the fact is undefined either — never treated as "known false"', () => {
      const input = baseInput({
        order: order({ buyerHasTaxId: undefined }),
        countryRules: [rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }] })],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'unresolved',
        reason: 'no-matching-rule',
      });
    });

    it('should fall through cleanly to the country default when the only rule needs a known buyerHasTaxId', () => {
      const input = baseInput({
        order: order({ buyerHasTaxId: undefined }),
        countryRules: [rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] })],
        countryDefaults: [{ documentKind: 'invoice', connectionId: 'conn-infakt' }],
      });
      expect(evaluateSalesDocumentRules(input)).toEqual({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-infakt',
      });
    });
  });
});
