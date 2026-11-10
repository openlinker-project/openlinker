/**
 * Promotion form model tests (#3935)
 */
import { describe, expect, it } from 'vitest';
import type { Promotion } from '../api/promotions.types';
import {
  emptyPromotionForm,
  formToWriteInput,
  kindOfPromotion,
  promotionToForm,
  suggestPromotionName,
  validatePromotionForm,
  type PromotionFormValues,
} from './promotion-form';

const spoon = { productId: 'p-spoon', variantId: 'v-spoon', name: 'Spoon' };
const set = { productId: 'p-set', variantId: 'v-set', name: 'Morning set' };

function filled(overrides: Partial<PromotionFormValues> = {}): PromotionFormValues {
  return {
    ...emptyPromotionForm('product', new Date('2026-11-05T10:00:00Z')),
    name: 'Spoon with the set',
    when: set,
    gift: spoon,
    ...overrides,
  };
}

describe('validatePromotionForm', () => {
  it('should find nothing missing when a product promotion is complete', () => {
    expect(validatePromotionForm(filled())).toEqual([]);
  });

  it('should list what is missing in the order the form reads', () => {
    const empty = emptyPromotionForm('product', new Date('2026-11-05T10:00:00Z'));
    expect(validatePromotionForm(empty)).toEqual(['name', 'when', 'gift']);
  });

  it('should ask for an amount, not a product, on an amount promotion', () => {
    const problems = validatePromotionForm(filled({ kind: 'basket', when: null, basketMin: '' }));
    expect(problems).toEqual(['basket']);
    expect(validatePromotionForm(filled({ kind: 'basket', when: null, basketMin: '150' }))).toEqual([]);
  });

  it('should refuse an end date before the start', () => {
    expect(validatePromotionForm(filled({ from: '2026-11-05', to: '2026-11-01' }))).toEqual(['period']);
  });

  it('should refuse a piece limit that is not a whole number', () => {
    expect(validatePromotionForm(filled({ unitCap: '2.5' }))).toEqual(['unit-cap']);
  });
});

describe('stacking and documents', () => {
  it('should send the chosen promotions only for "only with selected"', () => {
    expect(formToWriteInput(filled({ combineMode: 'none' }), true).combinesWith).toEqual({ mode: 'none' });
    expect(
      formToWriteInput(filled({ combineMode: 'selected', combineIds: ['a', 'b'] }), true).combinesWith,
    ).toEqual({ mode: 'selected', promotionIds: ['a', 'b'] });
  });

  it('should refuse "only with selected" with nothing selected', () => {
    expect(validatePromotionForm(filled({ combineMode: 'selected' }))).toEqual(['combine']);
  });

  it('should carry a custom price only with the custom-price form and demand a valid one', () => {
    expect(validatePromotionForm(filled({ documentForm: 'custom-price' }))).toEqual(['doc-price']);
    const input = formToWriteInput(filled({ documentForm: 'custom-price', documentUnitPrice: '2.50' }), true);
    expect(input.benefit).toMatchObject({ documentForm: 'custom-price', documentUnitPrice: '2.50' });
    expect(
      formToWriteInput(filled({ documentForm: 'omit', documentUnitPrice: '2.50' }), true).benefit,
    ).not.toHaveProperty('documentUnitPrice');
  });
});

describe('formToWriteInput', () => {
  it('should name the picked variant in the condition and keep the defaults the spec sets', () => {
    const input = formToWriteInput(filled(), true);

    expect(input.conditions).toEqual([{ field: 'containsProduct', op: 'eq', value: 'v-set' }]);
    expect(input.benefit).toMatchObject({
      kind: 'free-gift',
      productId: 'p-spoon',
      variantId: 'v-spoon',
      quantity: 1,
      perUnit: null,
      skipIfPresent: true,
    });
    expect(input.combinesWith).toEqual({ mode: 'all' });
    expect(input.limits).toEqual({ unitCap: null, customerLimit: 1 });
    expect(input.isActive).toBe(true);
  });

  it('should send channels only when the operator narrowed them', () => {
    expect(formToWriteInput(filled(), true).conditions).toHaveLength(1);
    const narrowed = formToWriteInput(filled({ channelIds: ['c-1', 'c-2'] }), true);
    expect(narrowed.conditions).toContainEqual({
      field: 'sourceConnectionIn',
      op: 'in',
      values: ['c-1', 'c-2'],
    });
  });

  it('should count units of the product on a per-unit promotion', () => {
    const input = formToWriteInput(filled({ kind: 'unit', perN: '2', maxPerOrder: '3' }), false);

    expect(input.benefit.perUnit).toEqual({ productId: 'p-set', per: 2, maxPerOrder: 3 });
    expect(input.isActive).toBe(false);
  });

  it('should send the amount as a decimal string with its currency', () => {
    const input = formToWriteInput(
      filled({ kind: 'basket', when: null, basketMin: '150.00', currency: 'PLN' }),
      true,
    );

    expect(input.conditions).toEqual([
      { field: 'orderTotalGross', op: 'gte', amount: '150.00', currency: 'PLN' },
    ]);
  });

  it('should carry the gift document form only when the operator chose one', () => {
    expect(formToWriteInput(filled(), true).benefit).not.toHaveProperty('documentForm');
    expect(formToWriteInput(filled({ documentForm: 'show-zero' }), true).benefit.documentForm).toBe(
      'show-zero',
    );
  });

  it('should keep an end date to the end of that day', () => {
    const input = formToWriteInput(filled({ to: '2026-11-30' }), true);
    expect(input.effectiveTo).toBe('2026-11-30T23:59:59.999Z');
  });
});

describe('promotionToForm', () => {
  const rule: Promotion = {
    id: 'r1',
    name: 'Spoon with the set',
    isActive: true,
    position: 1,
    effectiveFrom: '2026-11-01T00:00:00.000Z',
    effectiveTo: null,
    conditions: [
      { field: 'containsProduct', op: 'eq', value: 'v-set' },
      { field: 'sourceConnectionIn', op: 'in', values: ['c-1'] },
    ],
    benefit: {
      kind: 'free-gift',
      productId: 'p-spoon',
      variantId: 'v-spoon',
      quantity: 2,
      perUnit: null,
      skipIfPresent: false,
      documentForm: 'custom-price',
      documentUnitPrice: '2.50',
    },
    combinesWith: { mode: 'selected', promotionIds: ['x'] },
    limits: { unitCap: 200, customerLimit: 1 },
    status: 'active',
    pausedReason: null,
    pausedAt: null,
    unitsGiven: 40,
    effectiveCap: 200,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  it('should read a saved rule back into the form with the names it was given', () => {
    const form = promotionToForm(rule, new Map([['v-set', 'Morning set'], ['v-spoon', 'Spoon']]));

    expect(form).toMatchObject({
      kind: 'product',
      when: { variantId: 'v-set', name: 'Morning set' },
      gift: { variantId: 'v-spoon', name: 'Spoon' },
      giftQuantity: '2',
      unitCap: '200',
      combineMode: 'selected',
      combineIds: ['x'],
      customerLimit: '1',
      skipIfPresent: false,
      channelIds: ['c-1'],
      documentForm: 'custom-price',
      documentUnitPrice: '2.50',
    });
  });

  it('should show the id when a name could not be resolved', () => {
    expect(promotionToForm(rule).when?.name).toBe('v-set');
  });

  it('should tell the three kinds apart by what the rule holds', () => {
    expect(kindOfPromotion(rule)).toBe('product');
    expect(
      kindOfPromotion({
        benefit: rule.benefit,
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '150', currency: 'PLN' }],
      }),
    ).toBe('basket');
    expect(
      kindOfPromotion({
        benefit: { ...rule.benefit, perUnit: { productId: 'p', per: 2, maxPerOrder: null } },
        conditions: rule.conditions,
      }),
    ).toBe('unit');
  });
});

describe('suggestPromotionName', () => {
  const template = {
    product: '{gift} with {product}',
    basket: '{gift} for orders from {amount}',
    unit: '{gift} for every {product}',
  };

  it('should build the name from the gift and what triggers it', () => {
    expect(suggestPromotionName(filled(), template)).toBe('Spoon with Morning set');
    expect(suggestPromotionName(filled({ kind: 'basket', when: null, basketMin: '150' }), template)).toBe(
      'Spoon for orders from 150',
    );
  });

  it('should suggest nothing before a gift is picked', () => {
    expect(suggestPromotionName(filled({ gift: null }), template)).toBe('');
  });
});
