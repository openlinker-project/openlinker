/**
 * Condition-vocabulary rule tests (#3189, #3241 review)
 *
 * `compareDecimalAmountStrings` was shipped with no test and no caller while
 * the architecture overview described it as the routing comparison. The doc is
 * corrected; this pins the behaviour so its real consumer (#3190's overlap
 * detector, which intersects two AUTHORED amounts) rests on something the
 * build checks rather than on inspection.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import {
  compareDecimalAmountStrings,
  isCurrencyCode,
  isDecimalAmountString,
  isSalesDocumentCondition,
} from './sales-document-condition.types';

describe('compareDecimalAmountStrings', () => {
  it('orders by value, not lexically', () => {
    // The whole point: '9.00' sorts after '10.00' as text.
    expect(compareDecimalAmountStrings('9.00', '10.00')).toBeLessThan(0);
    expect(compareDecimalAmountStrings('10.00', '9.00')).toBeGreaterThan(0);
  });

  it('treats differently-written equal amounts as equal', () => {
    expect(compareDecimalAmountStrings('450', '450.00')).toBe(0);
    expect(compareDecimalAmountStrings('450.5', '450.50')).toBe(0);
  });

  it('compares fractional parts of different widths correctly', () => {
    expect(compareDecimalAmountStrings('450.5', '450.45')).toBeGreaterThan(0);
    expect(compareDecimalAmountStrings('0.1', '0.09')).toBeGreaterThan(0);
  });

  // The reason the function exists rather than `parseFloat`: this pair is
  // exactly equal as decimals and unequal as binary floats.
  it('does not reintroduce binary-float error', () => {
    expect(compareDecimalAmountStrings('0.1', '0.1')).toBe(0);
    expect(compareDecimalAmountStrings('1234567890123456789.01', '1234567890123456789.02')).toBeLessThan(0);
  });
});

describe('isDecimalAmountString', () => {
  it.each(['0', '450', '450.00', '0.05'])('accepts %s', (value) => {
    expect(isDecimalAmountString(value)).toBe(true);
  });

  it.each(['', ' ', '450,00', '-1', 'abc', '450.', 4.5, null, undefined])(
    'rejects %p',
    (value) => {
      expect(isDecimalAmountString(value)).toBe(false);
    },
  );
});

describe('isCurrencyCode', () => {
  it.each(['PLN', 'EUR'])('accepts %s', (value) => {
    expect(isCurrencyCode(value)).toBe(true);
  });

  it.each(['pln', 'PL', 'PLNN', '', 123, null])('rejects %p', (value) => {
    expect(isCurrencyCode(value)).toBe(false);
  });
});

describe('isSalesDocumentCondition', () => {
  it('accepts each arm of the closed vocabulary', () => {
    expect(isSalesDocumentCondition({ field: 'buyerHasTaxId', op: 'eq', value: true })).toBe(true);
    expect(isSalesDocumentCondition({ field: 'orderCountry', op: 'eq', value: 'PL' })).toBe(true);
    expect(
      isSalesDocumentCondition({
        field: 'orderTotalGross',
        op: 'lt',
        amount: '450.00',
        currency: 'PLN',
      }),
    ).toBe(true);
  });

  // Callers read `false` as "this rule never matches", silently - which is why
  // the narrowing has to be exact rather than forgiving.
  it('rejects an amount condition carrying a JSON number', () => {
    expect(
      isSalesDocumentCondition({
        field: 'orderTotalGross',
        op: 'lt',
        amount: 450,
        currency: 'PLN',
      }),
    ).toBe(false);
  });

  it('rejects a legacy thresholdRef-shaped condition', () => {
    expect(
      isSalesDocumentCondition({
        field: 'orderTotalGross',
        op: 'lt',
        thresholdRef: 'pl-simplified-invoice-2026',
      }),
    ).toBe(false);
  });

  it('rejects an unknown field and a mismatched operator', () => {
    expect(isSalesDocumentCondition({ field: 'orderWeight', op: 'lt', amount: '1', currency: 'PLN' })).toBe(false);
    expect(isSalesDocumentCondition({ field: 'buyerHasTaxId', op: 'gte', value: true })).toBe(false);
  });
});
