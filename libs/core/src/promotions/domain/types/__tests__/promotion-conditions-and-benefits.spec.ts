import { BENEFIT_POLICIES } from '../../domain-services/benefit-policies/benefit-policy';
import { computePromotionDefinitionHash } from '../promotion-definition-hash.types';
import {
  PromotionBenefitKindValues,
  PromotionGiftDocumentFormValues,
  isPromotionBenefit,
} from '../promotion-benefit.types';
import {
  PROMOTION_CONDITION_DESCRIPTORS,
  PromotionConditionFieldValues,
  evaluatePromotionCondition,
  isPromotionCondition,
  type PromotionCondition,
} from '../promotion-condition.types';

const FACTS = {
  orderId: 'o1',
  sourceConnectionId: 'c1',
  country: 'PL',
  totalGross: 100,
  currency: 'PLN',
  lineProductIds: ['p-book'],
  lineVariantIds: ['v-book'],
};

describe('promotion condition descriptors', () => {
  it('should have exactly one descriptor per declared field', () => {
    expect(Object.keys(PROMOTION_CONDITION_DESCRIPTORS).sort()).toEqual(
      [...PromotionConditionFieldValues].sort()
    );
  });

  const cases: Array<[string, PromotionCondition, string, Partial<typeof FACTS> | null]> = [
    ['orderTotalGross gte met', { field: 'orderTotalGross', op: 'gte', amount: '100.00', currency: 'PLN' }, 'true', {}],
    ['orderTotalGross gte not met', { field: 'orderTotalGross', op: 'gte', amount: '100.01', currency: 'PLN' }, 'false', {}],
    ['orderTotalGross lt met', { field: 'orderTotalGross', op: 'lt', amount: '150', currency: 'PLN' }, 'true', {}],
    ['orderTotalGross in another currency', { field: 'orderTotalGross', op: 'gte', amount: '1', currency: 'EUR' }, 'currency-mismatch', {}],
    ['containsProduct by product', { field: 'containsProduct', op: 'eq', value: 'p-book' }, 'true', {}],
    ['containsProduct by variant', { field: 'containsProduct', op: 'eq', value: 'v-book' }, 'true', {}],
    ['containsProduct absent', { field: 'containsProduct', op: 'eq', value: 'p-x' }, 'false', {}],
    ['sourceConnection equal', { field: 'sourceConnection', op: 'eq', value: 'c1' }, 'true', {}],
    ['sourceConnection different', { field: 'sourceConnection', op: 'eq', value: 'c2' }, 'false', {}],
    ['sourceConnectionIn member', { field: 'sourceConnectionIn', op: 'in', values: ['c0', 'c1'] }, 'true', {}],
    ['sourceConnectionIn non-member', { field: 'sourceConnectionIn', op: 'in', values: ['c0'] }, 'false', {}],
    ['orderCountry equal', { field: 'orderCountry', op: 'eq', value: 'PL' }, 'true', {}],
    ['orderCountry different', { field: 'orderCountry', op: 'eq', value: 'DE' }, 'false', {}],
  ];

  it.each(cases)('should evaluate %s', (_name, condition, expected, override) => {
    expect(evaluatePromotionCondition(condition, { ...FACTS, ...override })).toBe(expected);
  });

  it.each([
    ['orderTotalGross', { field: 'orderTotalGross', op: 'gte', amount: '1', currency: 'PLN' }, { orderId: 'o', totalGross: undefined }],
    ['containsProduct', { field: 'containsProduct', op: 'eq', value: 'x' }, { orderId: 'o' }],
    ['sourceConnection', { field: 'sourceConnection', op: 'eq', value: 'x' }, { orderId: 'o' }],
    ['sourceConnectionIn', { field: 'sourceConnectionIn', op: 'in', values: ['x'] }, { orderId: 'o' }],
    ['orderCountry', { field: 'orderCountry', op: 'eq', value: 'PL' }, { orderId: 'o' }],
  ] as Array<[string, PromotionCondition, { orderId: string }]>)(
    'should read an unasserted fact as unknown for %s, never false',
    (_field, condition, facts) => {
      expect(evaluatePromotionCondition(condition, facts)).toBe('unknown');
    }
  );

  it.each([
    [{ field: 'orderTotalGross', op: 'gte', amount: '1.234', currency: 'PLN' }],
    [{ field: 'orderTotalGross', op: 'eq', amount: '1', currency: 'PLN' }],
    [{ field: 'orderTotalGross', op: 'gte', amount: '1', currency: 'pln' }],
    [{ field: 'containsProduct', op: 'eq', value: '' }],
    [{ field: 'sourceConnectionIn', op: 'in', values: [] }],
    [{ field: 'holdReason', op: 'eq', value: 'x' }],
    [null],
    ['x'],
    [[]],
  ])('should refuse a malformed condition %j without throwing', (value) => {
    expect(isPromotionCondition(value)).toBe(false);
  });
});

describe('promotion benefits', () => {
  const GIFT = {
    kind: 'free-gift',
    productId: 'p',
    variantId: 'v',
    quantity: 1,
    perUnit: null,
    skipIfPresent: true,
  };

  it('should have a policy for every benefit kind', () => {
    expect(Object.keys(BENEFIT_POLICIES).sort()).toEqual([...PromotionBenefitKindValues].sort());
    for (const kind of PromotionBenefitKindValues) expect(BENEFIT_POLICIES[kind].kind).toBe(kind);
  });

  it('should carry the same document forms as the order line gift', () => {
    expect([...PromotionGiftDocumentFormValues]).toEqual([
      'technical-cent',
      'priced-in',
      'show-zero',
      'omit',
    ]);
  });

  it('should accept a well-formed free gift, with or without a form and per-unit block', () => {
    expect(isPromotionBenefit(GIFT)).toBe(true);
    expect(isPromotionBenefit({ ...GIFT, documentForm: 'priced-in' })).toBe(true);
    expect(isPromotionBenefit({ ...GIFT, perUnit: { productId: 'x', per: 2, maxPerOrder: null } })).toBe(true);
  });

  it.each([
    ['an unknown kind', { ...GIFT, kind: 'percent-off' }],
    ['a non-positive quantity', { ...GIFT, quantity: 0 }],
    ['a missing perUnit', { ...GIFT, perUnit: undefined }],
    ['a missing option', { ...GIFT, skipIfPresent: undefined }],
    ['an unknown document form', { ...GIFT, documentForm: 'free' }],
    ['a per-unit block without a product', { ...GIFT, perUnit: { per: 1, maxPerOrder: null } }],
  ])('should refuse %s', (_name, value) => {
    expect(isPromotionBenefit(value)).toBe(false);
  });
});

describe('promotion definition hash', () => {
  const benefit = {
    kind: 'free-gift' as const,
    productId: 'p',
    variantId: 'v',
    quantity: 1,
    perUnit: null,
    skipIfPresent: true,
  };
  const a: PromotionCondition = { field: 'containsProduct', op: 'eq', value: 'p-book' };
  const b: PromotionCondition = { field: 'orderCountry', op: 'eq', value: 'PL' };
  const limits = { unitCap: null, customerLimit: null };

  it('should not depend on the authoring order of conditions or of object keys', () => {
    const one = computePromotionDefinitionHash({ conditions: [a, b], benefit, combinable: true, limits });
    const two = computePromotionDefinitionHash({
      conditions: [b, a],
      benefit: { skipIfPresent: true, perUnit: null, quantity: 1, variantId: 'v', productId: 'p', kind: 'free-gift' },
      combinable: true,
      limits,
    });
    expect(one).toBe(two);
  });

  it('should change when the benefit, combinability or a limit changes', () => {
    const base = computePromotionDefinitionHash({ conditions: [a], benefit, combinable: true, limits });
    expect(computePromotionDefinitionHash({ conditions: [a], benefit: { ...benefit, quantity: 2 }, combinable: true, limits })).not.toBe(base);
    expect(computePromotionDefinitionHash({ conditions: [a], benefit, combinable: false, limits })).not.toBe(base);
    expect(computePromotionDefinitionHash({ conditions: [a], benefit, combinable: true, limits: { unitCap: 5, customerLimit: null } })).not.toBe(base);
  });
});
