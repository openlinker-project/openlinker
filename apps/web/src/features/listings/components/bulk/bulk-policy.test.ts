/**
 * Bulk policy helper - unit tests (#792 PR 3)
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it } from 'vitest';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import { allegroOfferValidation } from '../allegro/allegro-offer-validation';
import {
  clampMarkupPercent,
  computeBlockers,
  computeResolvedPrice,
  computeResolvedStock,
  roundHalfUp,
  type ComputeBlockersInput,
} from './bulk-policy';

// #1096 - `needs-product-parameters` is emitted by Allegro's row validator
// (passed via `platformValidate`), not inline in `computeBlockers`. The blocker
// id is now namespaced.
const allegroValidate = allegroOfferValidation.validateRow;
const NEEDS_PARAMS = 'allegro:needs-product-parameters';

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

  it('suppresses the category blocker for a destination that resolves it at submit (#1096)', () => {
    // A `borrows` destination (Erli) resolves the category server-side at submit
    // (override → barcode → mapping), so a pre-flight non-match must not block.
    const cases: ComputeBlockersInput['categoryResult'][] = [
      { kind: 'no-match' },
      { kind: 'no-ean' },
      { kind: 'multi-match', candidates: [] },
    ];
    for (const categoryResult of cases) {
      expect(
        computeBlockers(base({ categoryResult, destinationResolvesCategoryAtSubmit: true })),
      ).toEqual([]);
    }
  });

  it('still blocks price/stock when category resolves at submit', () => {
    // The submit-time category resolution doesn't excuse genuine price/stock gaps.
    expect(
      computeBlockers(
        base({
          categoryResult: { kind: 'no-match' },
          destinationResolvesCategoryAtSubmit: true,
          masterPrice: null,
        }),
      ),
    ).toEqual(['no-master-price']);
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

  // #810/#1096 - needs-product-parameters via Allegro's platform validator
  // (no card to inherit from + required product params).
  const withPickedCategory = (extra: Partial<ComputeBlockersInput> = {}) =>
    base({
      categoryResult: { kind: 'no-match' },
      override: { overrides: { categoryId: 'cat-1' } },
      willLinkProductCard: false,
      platformValidate: allegroValidate,
      ...extra,
    });

  it('fires needs-product-parameters when no card links and a required product param is missing', () => {
    const result = computeBlockers(
      withPickedCategory({ requiredProductParamIds: ['brand', 'model'] }),
    );
    expect(result).toContain(NEEDS_PARAMS);
  });

  it('does NOT fire when all required product params are supplied (clearable)', () => {
    const result = computeBlockers(
      withPickedCategory({
        requiredProductParamIds: ['brand', 'model'],
        override: {
          overrides: {
            categoryId: 'cat-1',
            parameters: [
              { id: 'brand', valuesIds: ['x'], section: 'product' },
              { id: 'model', values: ['Z9'], section: 'product' },
            ],
          },
        },
      }),
    );
    expect(result).not.toContain(NEEDS_PARAMS);
  });

  it('does NOT fire when the row links a product card (params inherited, #808)', () => {
    const result = computeBlockers(
      withPickedCategory({
        willLinkProductCard: true,
        requiredProductParamIds: ['brand'],
      }),
    );
    expect(result).not.toContain(NEEDS_PARAMS);
  });

  it('does NOT fire while the category schema is still unknown (undefined ids)', () => {
    const result = computeBlockers(withPickedCategory({ requiredProductParamIds: undefined }));
    expect(result).not.toContain(NEEDS_PARAMS);
  });

  it('does NOT fire for a category with no required product params (empty ids)', () => {
    const result = computeBlockers(withPickedCategory({ requiredProductParamIds: [] }));
    expect(result).not.toContain(NEEDS_PARAMS);
  });

  it('orders the param blocker before price/stock', () => {
    const result = computeBlockers(
      withPickedCategory({
        requiredProductParamIds: ['brand'],
        masterPrice: null,
        masterStock: null,
      }),
    );
    expect(result).toEqual([NEEDS_PARAMS, 'no-master-price', 'no-master-stock']);
  });
});

// ── Per-variant helpers (#1741) ──────────────────────────────────────────────
import {
  distinguishingLabel,
  duplicateEanVariantIds,
  effectiveVariantEan,
  imageCountForVariant,
  isValidGtin,
  recomputeVariantBlockers,
} from './bulk-policy';
import type {
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
} from './bulk-wizard.types';
import type { ProductVariant } from '../../../products';

function makeVariant(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant: ProductVariant = {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: 'M' },
    ean: '5901234123457',
    gtin: null,
    price: 39,
  } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
    masterStock: 10,
    masterPrice: 39,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: 'cat-1',
    resolvedProductCardId: 'card-1',
    resolutionMethod: 'auto_detect',
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

const CONFIG: BulkWizardConfig = {
  connectionId: 'conn_1',
  platformParams: {},
  currency: 'PLN',
  pricingPolicy: { mode: 'use-master' },
  stockPolicy: { mode: 'use-master' },
  publishImmediately: true,
  generateDescription: false,
};

function makeWizardRow(variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId: 'prod_1',
    product: { id: 'prod_1', name: 'P', images: ['a.jpg'] } as unknown as BulkWizardRow['product'],
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}

describe('isValidGtin', () => {
  it('accepts a valid EAN-13 and rejects a bad check digit / non-numeric', () => {
    expect(isValidGtin('5901234123457')).toBe(true);
    expect(isValidGtin('5901234567890')).toBe(false);
    expect(isValidGtin('abc')).toBe(false);
  });
});

describe('effectiveVariantEan', () => {
  it('prefers the override EAN, then the master barcode', () => {
    expect(effectiveVariantEan(makeVariant('ol_variant_1'))).toBe('5901234123457');
    expect(
      effectiveVariantEan(makeVariant('ol_variant_1', { override: { overrides: { ean: '4006381333931' } } })),
    ).toBe('4006381333931');
  });
});

describe('distinguishingLabel', () => {
  it('uses attributes, falling back to Variant {n}', () => {
    expect(distinguishingLabel(makeVariant('ol_variant_1'), 0)).toBe('Rozmiar: M');
    expect(distinguishingLabel(makeVariant('ol_variant_1', { distinguishingAttributes: null }), 2)).toBe(
      'Variant 3',
    );
  });
});

describe('imageCountForVariant', () => {
  it('counts the override image set when present, else the master', () => {
    const row = makeWizardRow([makeVariant('ol_variant_1')]);
    expect(imageCountForVariant(row, row.variants[0])).toBe(1);
    const withOverride = makeVariant('ol_variant_1', { override: { overrides: { imageUrls: [] } } });
    expect(imageCountForVariant(makeWizardRow([withOverride]), withOverride)).toBe(0);
  });
});

describe('duplicateEanVariantIds', () => {
  it('flags two included variants sharing a valid EAN', () => {
    const rows = [
      makeWizardRow([
        makeVariant('ol_variant_1', { ean: '5901234123457' }),
        makeVariant('ol_variant_2', { ean: '5901234123457' }),
      ]),
    ];
    const dupes = duplicateEanVariantIds(rows);
    expect(dupes.has('ol_variant_1')).toBe(true);
    expect(dupes.has('ol_variant_2')).toBe(true);
  });

  it('ignores excluded variants', () => {
    const rows = [
      makeWizardRow([
        makeVariant('ol_variant_1', { ean: '5901234123457' }),
        makeVariant('ol_variant_2', { ean: '5901234123457', included: false }),
      ]),
    ];
    expect(duplicateEanVariantIds(rows).size).toBe(0);
  });
});

describe('recomputeVariantBlockers', () => {
  it('downgrades no-master-stock for a multi-variant sibling', () => {
    const variant = makeVariant('ol_variant_1', { masterStock: 0 });
    const row = makeWizardRow([variant, makeVariant('ol_variant_2')]);
    const blockers = recomputeVariantBlockers(
      row,
      variant,
      CONFIG,
      new Map(),
      undefined,
      false,
      true,
    );
    expect(blockers).not.toContain('no-master-stock');
  });

  it('flags an invalid supplied EAN as no-ean', () => {
    const variant = makeVariant('ol_variant_1', {
      override: { overrides: { ean: '5901234567890' } },
    });
    const row = makeWizardRow([variant]);
    const blockers = recomputeVariantBlockers(row, variant, CONFIG, new Map());
    expect(blockers).toContain('no-ean');
  });

  it('resolves blockers using the per-product policy over the batch default (#1741)', () => {
    // Master price is absent - the batch `use-master` policy would flag
    // no-master-price, but the product's shared-base override sets a flat price.
    const variant = makeVariant('ol_variant_1', { masterPrice: null });
    const row: BulkWizardRow = {
      ...makeWizardRow([variant, makeVariant('ol_variant_2')]),
      override: { pricingPolicy: { mode: 'flat', amount: 50 } },
    };
    const blockers = recomputeVariantBlockers(row, variant, CONFIG, new Map());
    expect(blockers).not.toContain('no-master-price');
  });

  it('clears no-ean when a valid rescue barcode is supplied for a barcode-less variant (#1741)', () => {
    const barcodeless = makeVariant('ol_variant_1', {
      variant: {
        id: 'ol_variant_1',
        productId: 'prod_1',
        sku: 's',
        attributes: null,
        ean: null,
        gtin: null,
        price: 39,
      } as unknown as ProductVariant,
      ean: null,
      resolvedCategoryId: null,
      resolvedProductCardId: null,
      blockers: ['no-ean'],
    });
    const row = makeWizardRow([barcodeless]);

    // No rescue barcode yet -> the no-ean blocker persists.
    expect(recomputeVariantBlockers(row, barcodeless, CONFIG, new Map())).toContain('no-ean');

    // Operator supplies a valid GTIN -> no-ean clears and the row is ready.
    const rescued: BulkVariantRow = { ...barcodeless, override: { overrides: { ean: '5901234123457' } } };
    const blockers = recomputeVariantBlockers(row, rescued, CONFIG, new Map());
    expect(blockers).not.toContain('no-ean');
    expect(blockers).toHaveLength(0);
  });
});
