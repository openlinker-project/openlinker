import { describe, it, expect } from 'vitest';
import {
  describeMatchedSalesDocumentRule,
  matchedRuleReadsBuyerTaxId,
} from './describe-matched-sales-document-rule';
import type {
  SalesDocumentMatchedRuleCondition,
  SalesDocumentMatchedRuleView,
} from '../api/orders.types';

const t = (_key: string, fallback: string): string => fallback;

function rule(overrides: Partial<SalesDocumentMatchedRuleView> = {}): SalesDocumentMatchedRuleView {
  return {
    id: 'rule-1',
    country: 'PL',
    conditions: [
      { field: 'buyerHasTaxId', op: 'eq', boolValue: true },
      { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' },
    ],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn-fiscal-1',
    ...overrides,
  };
}

describe('matchedRuleReadsBuyerTaxId (#3186)', () => {
  it('should be true when a condition names buyerHasTaxId', () => {
    expect(matchedRuleReadsBuyerTaxId(rule())).toBe(true);
  });

  it('should be false when no condition names buyerHasTaxId', () => {
    expect(
      matchedRuleReadsBuyerTaxId(rule({ conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }] })),
    ).toBe(false);
  });

  it('should be false for an empty conditions array', () => {
    expect(matchedRuleReadsBuyerTaxId(rule({ conditions: [] }))).toBe(false);
  });
});

describe('describeMatchedSalesDocumentRule (#3186)', () => {
  it('names the market, every condition, the kind and the connection', () => {
    const sentence = describeMatchedSalesDocumentRule(rule(), 'Fiscal Provider Sandbox', t);
    expect(sentence).toContain('PL');
    expect(sentence).toContain('has a tax ID');
    expect(sentence).toContain('total under 450.00 PLN');
    expect(sentence).toContain('fiscal receipt');
    expect(sentence).toContain('Fiscal Provider Sandbox');
  });

  it('describes a false buyerHasTaxId condition distinctly from a true one', () => {
    const sentence = describeMatchedSalesDocumentRule(
      rule({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', boolValue: false }] }),
      'conn',
      t,
    );
    expect(sentence).toContain('has no tax ID');
    expect(sentence).not.toContain('has a tax ID');
  });

  it('names orderCountry conditions by the country they compare against', () => {
    const sentence = describeMatchedSalesDocumentRule(
      rule({ conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'DE' }] }),
      'conn',
      t,
    );
    expect(sentence).toContain('ships to DE');
  });

  it('renders the ★ Rest of world scope distinctly from a real country code', () => {
    const sentence = describeMatchedSalesDocumentRule(rule({ country: '*' }), 'conn', t);
    expect(sentence).toContain('Rest of world');
    // Asserted against the scope PHRASE, not the bare code: since #3189 the
    // sentence also names a currency, and 'PLN' contains 'PL', so a substring
    // check on the code alone would fail on an unrelated, correct change.
    expect(sentence).not.toContain('the PL rule');
  });

  it('labels the invoice kind distinctly from the fiscal-receipt kind', () => {
    const sentence = describeMatchedSalesDocumentRule(
      rule({ documentKind: 'invoice' }),
      'conn',
      t,
    );
    expect(sentence).toContain('invoice');
    expect(sentence).not.toContain('fiscal receipt');
  });

  it('falls back to the raw open-world kind when it is not one of the two known kinds', () => {
    const sentence = describeMatchedSalesDocumentRule(
      rule({ documentKind: 'periodic-summary' }),
      'conn',
      t,
    );
    expect(sentence).toContain('periodic-summary');
  });

  it('echoes an unrecognised condition field instead of claiming it is about the total', () => {
    // `field` is a hand-written mirror of a closed `libs/core` union with no
    // mirror script behind it, so a fourth field reaches the browser at runtime
    // while this type still says three. It must not fall through into the
    // threshold sentence and make a false statement about the operator's rule.
    const sentence = describeMatchedSalesDocumentRule(
      rule({
        conditions: [
          {
            field: 'orderChannel',
            op: 'eq',
            stringValue: 'allegro',
          } as unknown as SalesDocumentMatchedRuleCondition,
        ],
      }),
      'conn',
      t,
    );
    expect(sentence).toContain('orderChannel');
    expect(sentence).not.toContain('threshold');
  });

  it('describes an orderTotalGross gte condition distinctly from lt', () => {
    const sentence = describeMatchedSalesDocumentRule(
      rule({
        conditions: [
          { field: 'orderTotalGross', op: 'gte', amount: '450.00', currency: 'PLN' },
        ],
      }),
      'conn',
      t,
    );
    expect(sentence).toContain('total at or above 450.00 PLN');
  });
});
