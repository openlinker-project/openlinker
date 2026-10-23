import { describe, expect, it } from 'vitest';
import { describeSalesDocumentCondition } from './describe-sales-document-condition';

describe('describeSalesDocumentCondition (#2170)', () => {
  it('describes a buyerHasTaxId condition', () => {
    expect(describeSalesDocumentCondition({ field: 'buyerHasTaxId', op: 'eq', boolValue: true })).toBe(
      'customer has a tax ID',
    );
    expect(describeSalesDocumentCondition({ field: 'buyerHasTaxId', op: 'eq', boolValue: false })).toBe(
      'customer has no tax ID',
    );
  });

  it('describes an orderCountry condition', () => {
    expect(
      describeSalesDocumentCondition({ field: 'orderCountry', op: 'eq', stringValue: 'DE' }),
    ).toBe('order country is DE');
  });

  it('describes an orderTotalGross condition with the amount and currency the operator typed (#3189)', () => {
    const description = describeSalesDocumentCondition({
      field: 'orderTotalGross',
      op: 'lt',
      amount: '450.00',
      currency: 'PLN',
    });
    expect(description).toBe('total < 450.00 PLN');
  });

  // A rule this build cannot read must not have a figure invented for it.
  it('falls back to ? for an orderTotalGross condition carrying no amount', () => {
    expect(describeSalesDocumentCondition({ field: 'orderTotalGross', op: 'gte' })).toBe(
      'total ≥ ?',
    );
  });
});
