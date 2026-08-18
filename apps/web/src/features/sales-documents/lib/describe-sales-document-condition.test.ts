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

  it('describes an orderTotalGross condition, referencing the thresholdRef, never a literal amount', () => {
    const description = describeSalesDocumentCondition({
      field: 'orderTotalGross',
      op: 'lt',
      thresholdRef: 'pl-simplified-invoice-2026',
    });
    expect(description).toBe('total < pl-simplified-invoice-2026');
  });
});
