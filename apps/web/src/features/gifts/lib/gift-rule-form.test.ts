/**
 * Gift rule form model tests (#3940)
 */
import { describe, expect, it } from 'vitest';
import type { GiftRule } from '../api/gifts.types';
import {
  emptyGiftRuleForm,
  formToWriteInput,
  kindOfRule,
  ruleToForm,
  suggestRuleName,
  validateGiftRuleForm,
  type GiftRuleFormValues,
} from './gift-rule-form';

const spoon = { productId: 'p-spoon', variantId: 'v-spoon', name: 'Spoon' };
const set = { productId: 'p-set', variantId: 'v-set', name: 'Morning set' };

function filled(overrides: Partial<GiftRuleFormValues> = {}): GiftRuleFormValues {
  return {
    ...emptyGiftRuleForm('product', new Date('2026-11-05T10:00:00Z')),
    name: 'Spoon with the set',
    when: set,
    gift: spoon,
    ...overrides,
  };
}

describe('validateGiftRuleForm', () => {
  it('should find nothing missing when a product promotion is complete', () => {
    expect(validateGiftRuleForm(filled())).toEqual([]);
  });

  it('should list what is missing in the order the form reads', () => {
    const empty = emptyGiftRuleForm('product', new Date('2026-11-05T10:00:00Z'));
    expect(validateGiftRuleForm(empty)).toEqual(['name', 'when', 'gift']);
  });

  it('should ask for an amount, not a product, on an amount promotion', () => {
    const problems = validateGiftRuleForm(filled({ kind: 'basket', when: null, basketMin: '' }));
    expect(problems).toEqual(['basket']);
    expect(validateGiftRuleForm(filled({ kind: 'basket', when: null, basketMin: '150' }))).toEqual([]);
  });

  it('should refuse an end date before the start', () => {
    expect(validateGiftRuleForm(filled({ from: '2026-11-05', to: '2026-11-01' }))).toEqual(['period']);
  });

  it('should refuse a piece limit that is not a whole number', () => {
    expect(validateGiftRuleForm(filled({ unitCap: '2.5' }))).toEqual(['unit-cap']);
  });
});

describe('formToWriteInput', () => {
  it('should name the picked variant in the condition and keep the defaults the spec sets', () => {
    const input = formToWriteInput(filled(), true);

    expect(input.conditions).toEqual([{ field: 'containsProduct', op: 'eq', value: 'v-set' }]);
    expect(input.gift).toMatchObject({
      productId: 'p-spoon',
      variantId: 'v-spoon',
      quantity: 1,
      perUnit: null,
      unitCap: null,
      skipIfPresent: true,
      doNotCombine: false,
      customerLimit: null,
    });
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

    expect(input.gift.perUnit).toEqual({ productId: 'p-set', per: 2, maxPerOrder: 3 });
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
    expect(formToWriteInput(filled(), true).gift).not.toHaveProperty('documentForm');
    expect(formToWriteInput(filled({ documentForm: 'show-zero' }), true).gift.documentForm).toBe(
      'show-zero',
    );
  });

  it('should keep an end date to the end of that day', () => {
    const input = formToWriteInput(filled({ to: '2026-11-30' }), true);
    expect(input.effectiveTo).toBe('2026-11-30T23:59:59.999Z');
  });
});

describe('ruleToForm', () => {
  const rule: GiftRule = {
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
    gift: {
      productId: 'p-spoon',
      variantId: 'v-spoon',
      quantity: 2,
      perUnit: null,
      unitCap: 200,
      skipIfPresent: false,
      doNotCombine: true,
      customerLimit: null,
      documentForm: 'priced-in',
    },
    status: 'active',
    pausedReason: null,
    pausedAt: null,
    unitsGiven: 40,
    effectiveCap: 200,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  it('should read a saved rule back into the form with the names it was given', () => {
    const form = ruleToForm(rule, new Map([['v-set', 'Morning set'], ['v-spoon', 'Spoon']]));

    expect(form).toMatchObject({
      kind: 'product',
      when: { variantId: 'v-set', name: 'Morning set' },
      gift: { variantId: 'v-spoon', name: 'Spoon' },
      giftQuantity: '2',
      unitCap: '200',
      doNotCombine: true,
      skipIfPresent: false,
      channelIds: ['c-1'],
      documentForm: 'priced-in',
    });
  });

  it('should show the id when a name could not be resolved', () => {
    expect(ruleToForm(rule).when?.name).toBe('v-set');
  });

  it('should tell the three kinds apart by what the rule holds', () => {
    expect(kindOfRule(rule)).toBe('product');
    expect(
      kindOfRule({
        gift: rule.gift,
        conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '150', currency: 'PLN' }],
      }),
    ).toBe('basket');
    expect(
      kindOfRule({
        gift: { ...(rule.gift as NonNullable<GiftRule['gift']>), perUnit: { productId: 'p', per: 2, maxPerOrder: null } },
        conditions: rule.conditions,
      }),
    ).toBe('unit');
  });
});

describe('suggestRuleName', () => {
  const template = {
    product: '{gift} with {product}',
    basket: '{gift} for orders from {amount}',
    unit: '{gift} for every {product}',
  };

  it('should build the name from the gift and what triggers it', () => {
    expect(suggestRuleName(filled(), template)).toBe('Spoon with Morning set');
    expect(suggestRuleName(filled({ kind: 'basket', when: null, basketMin: '150' }), template)).toBe(
      'Spoon for orders from 150',
    );
  });

  it('should suggest nothing before a gift is picked', () => {
    expect(suggestRuleName(filled({ gift: null }), template)).toBe('');
  });
});
