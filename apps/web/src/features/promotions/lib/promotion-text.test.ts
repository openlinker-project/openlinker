/**
 * Promotion one-line text tests (#3935)
 */
import { describe, expect, it } from 'vitest';
import type { Promotion } from '../api/promotions.types';
import { combineChip, conditionText } from './promotion-text';

const copy = {
  basket: 'Cart from {amount}',
  contains: 'Contains {product}',
  perUnit: 'For every {n} pcs of {product}',
  onlySelected: 'Only with selected ({n})',
  noCombine: 'Does not combine',
};

const base: Promotion = {
  id: 'p',
  name: 'n',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [],
  benefit: { kind: 'free-gift', productId: 'p', variantId: 'v', quantity: 1, perUnit: null, skipIfPresent: true },
  combinesWith: { mode: 'all' },
  limits: { unitCap: null, customerLimit: null },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('conditionText', () => {
  it('should read a cart amount', () => {
    const text = conditionText(
      { ...base, conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '200', currency: 'PLN' }] },
      copy,
      () => '',
    );
    expect(text).toMatch(/^Cart from /);
    expect(text).toContain('200');
  });

  it('should name the product for a product or per-unit condition', () => {
    const contains = [{ field: 'containsProduct', op: 'eq', value: 'v1' }] as Promotion['conditions'];
    expect(conditionText({ ...base, conditions: contains }, copy, () => 'Tea')).toBe('Contains Tea');
    const perUnit = { ...base.benefit, perUnit: { productId: 'p', per: 2, maxPerOrder: null } };
    expect(conditionText({ ...base, conditions: contains, benefit: perUnit }, copy, () => 'Mug')).toBe(
      'For every 2 pcs of Mug',
    );
  });
});

describe('combineChip', () => {
  it('should say nothing when the promotion stacks with all', () => {
    expect(combineChip(base, copy)).toBeNull();
  });

  it('should say so when it stacks with none or only with some', () => {
    expect(combineChip({ combinesWith: { mode: 'none' } }, copy)).toBe('Does not combine');
    expect(combineChip({ combinesWith: { mode: 'selected', promotionIds: ['a', 'b'] } }, copy)).toBe(
      'Only with selected (2)',
    );
  });
});
