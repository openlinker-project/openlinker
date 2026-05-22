/**
 * Bulk policy helper — unit tests (#792 PR 3)
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it } from 'vitest';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import {
  clampMarkupPercent,
  computeBlockers,
  computeResolvedPrice,
  computeResolvedStock,
  roundHalfUp,
  type ComputeBlockersInput,
} from './bulk-policy';

const NO_OVERRIDE: BulkPerProductOverride = {};

describe('roundHalfUp', () => {
  it('rounds half up to 2 decimals', () => {
    expect(roundHalfUp(13.205)).toBe(13.21);
    expect(roundHalfUp(13.2)).toBe(13.2);
    expect(roundHalfUp(12 * 1.1)).toBe(13.2);
  });
});

describe('clampMarkupPercent', () => {
  it('clamps to [-100, 500]', () => {
    expect(clampMarkupPercent(-250)).toBe(-100);
    expect(clampMarkupPercent(900)).toBe(500);
    expect(clampMarkupPercent(10)).toBe(10);
  });
});

describe('computeResolvedPrice', () => {
  it('uses master verbatim under use-master', () => {
    expect(computeResolvedPrice({ mode: 'use-master' }, 12, NO_OVERRIDE)).toEqual({
      value: 12,
      source: 'master',
      blocker: null,
    });
  });

  it('blocks no-master-price under use-master when master is null', () => {
    expect(computeResolvedPrice({ mode: 'use-master' }, null, NO_OVERRIDE)).toEqual({
      value: null,
      source: 'master',
      blocker: 'no-master-price',
    });
  });

  it('applies markup half-up under markup', () => {
    expect(computeResolvedPrice({ mode: 'markup', percent: 10 }, 12, NO_OVERRIDE)).toEqual({
      value: 13.2,
      source: 'policy',
      blocker: null,
    });
  });

  it('blocks no-master-price under markup when master is null', () => {
    expect(
      computeResolvedPrice({ mode: 'markup', percent: 10 }, null, NO_OVERRIDE).blocker,
    ).toBe('no-master-price');
  });

  it('blocks no-master-price when a markup zeroes the price (e.g. -100%)', () => {
    const result = computeResolvedPrice({ mode: 'markup', percent: -100 }, 12, NO_OVERRIDE);
    expect(result.value).toBeNull();
    expect(result.blocker).toBe('no-master-price');
  });

  it('blocks no-master-price under use-master when master price is 0', () => {
    expect(computeResolvedPrice({ mode: 'use-master' }, 0, NO_OVERRIDE).blocker).toBe(
      'no-master-price',
    );
  });

  it('uses the flat amount verbatim and never blocks', () => {
    expect(computeResolvedPrice({ mode: 'flat', amount: 79 }, null, NO_OVERRIDE)).toEqual({
      value: 79,
      source: 'policy',
      blocker: null,
    });
  });

  it('lets a per-row price override win over the policy', () => {
    const override: BulkPerProductOverride = { price: { amount: 99, currency: 'PLN' } };
    expect(computeResolvedPrice({ mode: 'use-master' }, null, override)).toEqual({
      value: 99,
      source: 'override',
      blocker: null,
    });
  });
});

describe('computeResolvedStock', () => {
  it('uses master under use-master', () => {
    expect(computeResolvedStock({ mode: 'use-master' }, 3, NO_OVERRIDE)).toEqual({
      value: 3,
      source: 'master',
      blocker: null,
    });
  });

  it('blocks no-master-stock under use-master when master is 0 or null', () => {
    expect(computeResolvedStock({ mode: 'use-master' }, 0, NO_OVERRIDE).blocker).toBe(
      'no-master-stock',
    );
    expect(computeResolvedStock({ mode: 'use-master' }, null, NO_OVERRIDE).blocker).toBe(
      'no-master-stock',
    );
  });

  it('caps to min(master, N) under cap', () => {
    expect(computeResolvedStock({ mode: 'cap', value: 5 }, 12, NO_OVERRIDE)).toEqual({
      value: 5,
      source: 'policy',
      blocker: null,
    });
    expect(computeResolvedStock({ mode: 'cap', value: 5 }, 3, NO_OVERRIDE).value).toBe(3);
  });

  it('blocks cap when master is null or the capped value is 0', () => {
    expect(computeResolvedStock({ mode: 'cap', value: 5 }, null, NO_OVERRIDE).blocker).toBe(
      'no-master-stock',
    );
    expect(computeResolvedStock({ mode: 'cap', value: 5 }, 0, NO_OVERRIDE).blocker).toBe(
      'no-master-stock',
    );
  });

  it('uses the flat value verbatim and never blocks', () => {
    expect(computeResolvedStock({ mode: 'flat', value: 7 }, null, NO_OVERRIDE)).toEqual({
      value: 7,
      source: 'policy',
      blocker: null,
    });
  });

  it('lets a per-row stock override win over the policy', () => {
    expect(computeResolvedStock({ mode: 'use-master' }, null, { stock: 4 })).toEqual({
      value: 4,
      source: 'override',
      blocker: null,
    });
  });
});

describe('computeBlockers', () => {
  function base(overrides: Partial<ComputeBlockersInput> = {}): ComputeBlockersInput {
    return {
      hasVariant: true,
      categoryResult: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
      pricingPolicy: { mode: 'use-master' },
      stockPolicy: { mode: 'use-master' },
      masterPrice: 12,
      masterStock: 3,
      masterCurrency: 'PLN',
      batchCurrency: 'PLN',
      override: {},
      ...overrides,
    };
  }

  it('returns no blockers for a fully-resolved matched row', () => {
    expect(computeBlockers(base())).toEqual([]);
  });

  it('returns exactly [no-variant] when the product has no variant', () => {
    expect(computeBlockers(base({ hasVariant: false }))).toEqual(['no-variant']);
  });

  it('maps category outcomes to blockers', () => {
    expect(computeBlockers(base({ categoryResult: { kind: 'no-ean' } }))).toEqual(['no-ean']);
    expect(computeBlockers(base({ categoryResult: { kind: 'no-match' } }))).toEqual(['no-match']);
    expect(
      computeBlockers(
        base({ categoryResult: { kind: 'multi-match', candidates: [] } }),
      ),
    ).toEqual(['multi-match']);
  });

  it('co-occurs no-ean + no-master-price', () => {
    const result = computeBlockers(
      base({ categoryResult: { kind: 'no-ean' }, masterPrice: null }),
    );
    expect(result).toEqual(['no-ean', 'no-master-price']);
  });

  it('fires currency-mismatch under markup when master currency differs', () => {
    const result = computeBlockers(
      base({ pricingPolicy: { mode: 'markup', percent: 10 }, masterCurrency: 'EUR' }),
    );
    expect(result).toContain('currency-mismatch');
  });

  it('does NOT fire currency-mismatch under flat pricing', () => {
    const result = computeBlockers(
      base({ pricingPolicy: { mode: 'flat', amount: 50 }, masterCurrency: 'EUR' }),
    );
    expect(result).not.toContain('currency-mismatch');
  });

  it('does NOT fire currency-mismatch when product currency is null', () => {
    const result = computeBlockers(base({ masterCurrency: null, masterPrice: 12 }));
    expect(result).not.toContain('currency-mismatch');
  });

  it('clears category + price + stock blockers once the operator overrides them', () => {
    const override: BulkPerProductOverride = {
      stock: 4,
      price: { amount: 50, currency: 'PLN' },
      overrides: { categoryId: 'cat-picked' },
    };
    const result = computeBlockers(
      base({
        categoryResult: { kind: 'multi-match', candidates: [] },
        masterPrice: null,
        masterStock: null,
        override,
      }),
    );
    expect(result).toEqual([]);
  });
});
