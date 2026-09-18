/**
 * Overlap-detection tests (#3190)
 *
 * The flagship scenario from the mockup drives the first three: 450 PLN and
 * 449 PLN collide, the same pair in different currencies provably cannot, and
 * nothing this build fails to read is ever reported as "no conflict".
 */
import {
  detectSalesDocumentRuleOverlap,
  salesDocumentRuleWindowsOverlap,
  type SalesDocumentRuleOverlapSubject,
} from './detect-sales-document-rule-overlap';

const FROM = new Date('2026-01-01T00:00:00Z');

function subject(
  overrides: Partial<SalesDocumentRuleOverlapSubject> = {},
): SalesDocumentRuleOverlapSubject {
  return {
    id: 'rival-1',
    connectionId: 'conn-receipt',
    documentKind: 'fiscal-receipt',
    conditions: [
      { field: 'buyerHasTaxId', op: 'eq', value: true },
      { field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' },
    ],
    effectiveFrom: FROM,
    effectiveTo: null,
    ...overrides,
  };
}

describe('detectSalesDocumentRuleOverlap (#3190)', () => {
  it('reports a rule that could match the same order, naming the rival', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [
          { field: 'buyerHasTaxId', op: 'eq', value: true },
          { field: 'orderTotalGross', op: 'lt', amount: '449.00', currency: 'PLN' },
        ],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject()],
    );

    expect(verdict.overlapping).toEqual([
      { ruleId: 'rival-1', connectionId: 'conn-receipt', documentKind: 'fiscal-receipt' },
    ]);
    expect(verdict.disjoint).toEqual([]);
    expect(verdict.undecided).toEqual([]);
  });

  it('proves non-overlap when the currencies differ, because amounts are never converted', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [
          { field: 'buyerHasTaxId', op: 'eq', value: true },
          { field: 'orderTotalGross', op: 'lt', amount: '100.00', currency: 'EUR' },
        ],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject()],
    );

    expect(verdict.overlapping).toEqual([]);
    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'currency' }]);
  });

  it('proves non-overlap when the amount bounds cannot both hold', () => {
    // `>= 450` against `< 450` - the two halves of the shipped PL template,
    // which must never be reported as colliding with each other.
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [
          { field: 'buyerHasTaxId', op: 'eq', value: true },
          { field: 'orderTotalGross', op: 'gte', amount: '450.00', currency: 'PLN' },
        ],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject()],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'amount-range' }]);
  });

  it('treats touching bounds as disjoint, since gte is inclusive and lt exclusive', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '450.00', currency: 'PLN' }],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [
        subject({
          conditions: [{ field: 'orderTotalGross', op: 'lt', amount: '450.00', currency: 'PLN' }],
        }),
      ],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'amount-range' }]);
  });

  it('proves non-overlap on opposite buyer-tax-id requirements', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: false }],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject({ conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }] })],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'buyer-tax-id' }]);
  });

  it('proves non-overlap on different delivery countries, case-insensitively', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [{ field: 'orderCountry', op: 'eq', value: 'de' }],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }] })],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'order-country' }]);
  });

  it('proves non-overlap when the effective windows never coincide', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }],
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
        effectiveTo: null,
      },
      [subject({ effectiveTo: new Date('2026-06-30T00:00:00Z') })],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'effective-window' }]);
  });

  // The whole reason the third outcome exists: an unreadable rival must not
  // be reported as harmless, because that is the false reassurance this check
  // was built to remove.
  it('reports a condition it cannot read as undecided, never as no-conflict', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: true }],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject({ conditions: [{ field: 'orderWeight', op: 'gte', amount: '1', currency: 'PLN' }] })],
    );

    expect(verdict.overlapping).toEqual([]);
    expect(verdict.disjoint).toEqual([]);
    expect(verdict.undecided).toEqual([{ ruleId: 'rival-1', reason: 'unreadable-condition' }]);
  });

  it('reports a multi-currency rule as undecided rather than calling it provably disjoint', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [
          { field: 'orderTotalGross', op: 'gte', amount: '10.00', currency: 'PLN' },
          { field: 'orderTotalGross', op: 'lt', amount: '20.00', currency: 'EUR' },
        ],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [subject()],
    );

    expect(verdict.undecided).toEqual([{ ruleId: 'rival-1', reason: 'multi-currency-rule' }]);
  });

  it('skips the row being edited, so a rule never collides with itself', () => {
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: subject().conditions,
        effectiveFrom: FROM,
        effectiveTo: null,
        excludeRuleId: 'rival-1',
      },
      [subject()],
    );

    expect(verdict).toEqual({ overlapping: [], disjoint: [], undecided: [] });
  });

  it('narrows several bounds on one field to their conjunction, not the last one written', () => {
    // `>= 100 AND < 200` against `>= 300`: only the tightened lower bound of
    // the rival makes these disjoint, so a last-one-wins reduction would
    // wrongly report a collision.
    const verdict = detectSalesDocumentRuleOverlap(
      {
        conditions: [
          { field: 'orderTotalGross', op: 'gte', amount: '100.00', currency: 'PLN' },
          { field: 'orderTotalGross', op: 'lt', amount: '200.00', currency: 'PLN' },
        ],
        effectiveFrom: FROM,
        effectiveTo: null,
      },
      [
        subject({
          conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '300.00', currency: 'PLN' }],
        }),
      ],
    );

    expect(verdict.disjoint).toEqual([{ ruleId: 'rival-1', reason: 'amount-range' }]);
  });
});

describe('salesDocumentRuleWindowsOverlap', () => {
  it('treats an absent end as open-ended', () => {
    expect(
      salesDocumentRuleWindowsOverlap(FROM, null, new Date('2099-01-01T00:00:00Z'), null),
    ).toBe(true);
  });

  it('refuses windows that merely abut in the wrong order', () => {
    expect(
      salesDocumentRuleWindowsOverlap(
        new Date('2026-07-01T00:00:00Z'),
        null,
        FROM,
        new Date('2026-06-30T00:00:00Z'),
      ),
    ).toBe(false);
  });
});
