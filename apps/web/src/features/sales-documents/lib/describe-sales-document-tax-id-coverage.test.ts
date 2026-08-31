import { describe, expect, it } from 'vitest';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import {
  countRulesUsingBuyerTaxId,
  usesBuyerTaxIdCondition,
} from './describe-sales-document-tax-id-coverage';

function makeRule(overrides: Partial<SalesDocumentRule> = {}): SalesDocumentRule {
  return {
    id: 'r1',
    country: 'PL',
    conditions: [],
    documentKind: 'invoice',
    connectionId: 'conn_1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    provenance: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('usesBuyerTaxIdCondition', () => {
  it('should return true when a rule carries a buyerHasTaxId condition', () => {
    const rule = makeRule({
      conditions: [{ field: 'buyerHasTaxId', op: 'eq', boolValue: false }],
    });

    expect(usesBuyerTaxIdCondition(rule)).toBe(true);
  });

  it('should return false when a rule carries only other condition kinds', () => {
    const rule = makeRule({
      conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }],
    });

    expect(usesBuyerTaxIdCondition(rule)).toBe(false);
  });

  it('should return false for a rule with no conditions', () => {
    expect(usesBuyerTaxIdCondition(makeRule({ conditions: [] }))).toBe(false);
  });
});

describe('countRulesUsingBuyerTaxId', () => {
  it('should count only the rules carrying a buyerHasTaxId condition', () => {
    const rules = [
      makeRule({ id: 'r1', conditions: [{ field: 'buyerHasTaxId', op: 'eq', boolValue: true }] }),
      makeRule({ id: 'r2', conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }] }),
      makeRule({ id: 'r3', conditions: [{ field: 'buyerHasTaxId', op: 'eq', boolValue: false }] }),
    ];

    expect(countRulesUsingBuyerTaxId(rules)).toBe(2);
  });

  it('should return 0 when no rules use the condition', () => {
    expect(countRulesUsingBuyerTaxId([makeRule()])).toBe(0);
  });
});
