import { describe, expect, it } from 'vitest';
import {
  buildProductExclusionMap,
  CROSS_REFERENCEABLE_CATEGORIES,
  type CoverageOrderLite,
} from './product-exclusion-map.lib';

/**
 * Unit coverage for `buildProductExclusionMap` (#2668 review, IMPORTANT 5).
 *
 * Its explicitly-mirrored sibling `channel-exclusion-map.lib.ts` shipped with a
 * test and this one did not, despite carrying strictly more logic — a per-order
 * distinct-`productId` dedup across two different row shapes, plus a `null`
 * skip. Its own docblock records that a prior revision "silently under-counted
 * every product past the first" (#2799 review BLOCKING 1), which is exactly the
 * class of regression a unit test on a pure function pins.
 */
describe('buildProductExclusionMap (#2799)', () => {
  it('returns an empty map when given no categories at all', () => {
    expect(buildProductExclusionMap({}).size).toBe(0);
  });

  it('returns an empty map when every category is present but empty (all-clear)', () => {
    const map = buildProductExclusionMap({
      currency: [],
      'tax-a': [],
      'tax-b': [],
      'tax-c': [],
    });

    expect(map.size).toBe(0);
  });

  it('counts EVERY distinct product a currency order touches, not just the first (#2799 review BLOCKING 1)', () => {
    // The regression this guards: a `DISTINCT ON (orderRecordId)` collapsed a
    // multi-product order to one representative line, so products 2..n on that
    // order were annotated on no row at all.
    const order: CoverageOrderLite = {
      internalOrderId: 'ol_order_1',
      sourceConnectionId: 'conn-1',
      lineProducts: [
        { productId: 'ol_product_1' },
        { productId: 'ol_product_2' },
        { productId: 'ol_product_3' },
      ],
    };

    const map = buildProductExclusionMap({ currency: [order] });

    expect(map.size).toBe(3);
    expect(map.get('ol_product_1')?.get('currency')).toBe(1);
    expect(map.get('ol_product_2')?.get('currency')).toBe(1);
    expect(map.get('ol_product_3')?.get('currency')).toBe(1);
  });

  it('reads a tax row through lineRates, the shape a currency row does not carry', () => {
    const order: CoverageOrderLite = {
      internalOrderId: 'ol_order_2',
      sourceConnectionId: 'conn-1',
      lineRates: [{ productId: 'ol_product_1' }, { productId: 'ol_product_2' }],
    };

    const map = buildProductExclusionMap({ 'tax-a': [order] });

    expect(map.get('ol_product_1')?.get('tax-a')).toBe(1);
    expect(map.get('ol_product_2')?.get('tax-a')).toBe(1);
  });

  it('counts one affected ORDER per product, not one per line, when a product repeats within an order', () => {
    // Two lines of the same order, same product. The map counts affected
    // ORDERS, so this is 1 — counting lines would over-report the row.
    const order: CoverageOrderLite = {
      internalOrderId: 'ol_order_3',
      sourceConnectionId: 'conn-1',
      lineRates: [
        { productId: 'ol_product_repeat' },
        { productId: 'ol_product_repeat' },
        { productId: 'ol_product_other' },
      ],
    };

    const map = buildProductExclusionMap({ 'tax-b': [order] });

    expect(map.get('ol_product_repeat')?.get('tax-b')).toBe(1);
    expect(map.get('ol_product_other')?.get('tax-b')).toBe(1);
  });

  it('accumulates across ORDERS within one category', () => {
    const map = buildProductExclusionMap({
      currency: [
        {
          internalOrderId: 'ol_order_a',
          sourceConnectionId: 'conn-1',
          lineProducts: [{ productId: 'ol_product_1' }],
        },
        {
          internalOrderId: 'ol_order_b',
          sourceConnectionId: 'conn-2',
          lineProducts: [{ productId: 'ol_product_1' }],
        },
      ],
    });

    expect(map.get('ol_product_1')?.get('currency')).toBe(2);
  });

  it('keeps categories independent for one product rather than summing them into one number', () => {
    const map = buildProductExclusionMap({
      currency: [
        {
          internalOrderId: 'ol_order_a',
          sourceConnectionId: 'conn-1',
          lineProducts: [{ productId: 'ol_product_1' }],
        },
      ],
      'tax-c': [
        {
          internalOrderId: 'ol_order_b',
          sourceConnectionId: 'conn-1',
          lineRates: [{ productId: 'ol_product_1' }],
        },
      ],
    });

    const byCategory = map.get('ol_product_1');
    expect(byCategory?.get('currency')).toBe(1);
    expect(byCategory?.get('tax-c')).toBe(1);
    expect(byCategory?.size).toBe(2);
  });

  it('unions lineProducts and lineRates on one row without double-counting a shared product', () => {
    const order: CoverageOrderLite = {
      internalOrderId: 'ol_order_4',
      sourceConnectionId: 'conn-1',
      lineProducts: [{ productId: 'ol_product_shared' }],
      lineRates: [{ productId: 'ol_product_shared' }, { productId: 'ol_product_only_rates' }],
    };

    const map = buildProductExclusionMap({ currency: [order] });

    expect(map.get('ol_product_shared')?.get('currency')).toBe(1);
    expect(map.get('ol_product_only_rates')?.get('currency')).toBe(1);
  });

  it('skips a null productId rather than keying the map on it', () => {
    // `productId` is DECLARED as `string`, but that is a claim about a JSON
    // body rather than a guarantee about one — a `null` reaching here would
    // otherwise create a `"null"` key that annotates no row (see the lib's own
    // note on the runtime guard).
    const order = {
      internalOrderId: 'ol_order_5',
      sourceConnectionId: 'conn-1',
      lineProducts: [
        { productId: null as unknown as string },
        { productId: 'ol_product_real' },
      ],
    } satisfies CoverageOrderLite;

    const map = buildProductExclusionMap({ currency: [order] });

    expect(map.size).toBe(1);
    expect(map.has('null')).toBe(false);
    expect(map.get('ol_product_real')?.get('currency')).toBe(1);
  });

  it('ignores a category outside CROSS_REFERENCEABLE_CATEGORIES, notably product-matching', () => {
    // A `'product-matching'` row's own `productId` is always null by
    // construction — the unresolved item reference IS why the row exists — so
    // the category is deliberately absent from the cross-referenceable set.
    expect(CROSS_REFERENCEABLE_CATEGORIES).not.toContain('product-matching');

    const map = buildProductExclusionMap({
      // Cast: the key is deliberately not a member of the accepted union.
      ...({ 'product-matching': [{ internalOrderId: 'x', sourceConnectionId: 'c' }] } as Record<
        string,
        CoverageOrderLite[]
      >),
    });

    expect(map.size).toBe(0);
  });
});
