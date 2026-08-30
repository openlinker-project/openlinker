import { describe, expect, it } from 'vitest';
import {
  computeItemCount,
  computeNeedEanCount,
  computeRailGroups,
  firstImage,
  variantHasBarcode,
  variantLabel,
  variantShortLabel,
} from './offer-product-picker-selectors';
import type { RailGroup, SelectionEntry } from '../components/offer-product-picker.types';
import type { Product, ProductVariant } from '../../products';

function makeVariant(id: string, overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id,
    productId: 'p1',
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStale: false,
    staleAt: null,
    ...overrides,
  };
}

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: `Product ${id}`,
    sku: null,
    price: null,
    currency: null,
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('variantLabel', () => {
  const product = makeProduct('p1');

  it('joins attributes when present', () => {
    const variant = makeVariant('v1', { attributes: { Color: 'Red', Size: 'M' } });
    expect(variantLabel(product, variant)).toBe('Product p1 - Red · M');
  });

  it('falls back to SKU when there are no attributes', () => {
    const variant = makeVariant('v1', { sku: 'SKU-1' });
    expect(variantLabel(product, variant)).toBe('Product p1 - SKU-1');
  });

  it('falls back to the product name alone when neither attributes nor SKU are present', () => {
    const variant = makeVariant('v1');
    expect(variantLabel(product, variant)).toBe('Product p1');
  });
});

describe('variantShortLabel', () => {
  it('joins attributes when present', () => {
    const variant = makeVariant('v1', { attributes: { Color: 'Red', Size: 'M' } });
    expect(variantShortLabel(variant)).toBe('Red · M');
  });

  it('falls back to SKU when there are no attributes', () => {
    const variant = makeVariant('v1', { sku: 'SKU-1' });
    expect(variantShortLabel(variant)).toBe('SKU-1');
  });

  it('falls back to the variant id when neither attributes nor SKU are present', () => {
    const variant = makeVariant('v1');
    expect(variantShortLabel(variant)).toBe('v1');
  });
});

describe('variantHasBarcode', () => {
  it('is true when EAN is present', () => {
    expect(variantHasBarcode(makeVariant('v1', { ean: '5901234123457' }))).toBe(true);
  });

  it('falls back to GTIN when EAN is absent', () => {
    expect(variantHasBarcode(makeVariant('v1', { ean: null, gtin: '00012345600012' }))).toBe(true);
  });

  it('is false when neither EAN nor GTIN is present', () => {
    expect(variantHasBarcode(makeVariant('v1', { ean: null, gtin: null }))).toBe(false);
  });

  it('is false when EAN is present but blank/whitespace-only', () => {
    expect(variantHasBarcode(makeVariant('v1', { ean: '   ', gtin: null }))).toBe(false);
  });
});

describe('firstImage', () => {
  it('returns the first image when present', () => {
    expect(firstImage(['a.jpg', 'b.jpg'])).toBe('a.jpg');
  });

  it('returns null for an empty array', () => {
    expect(firstImage([])).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(firstImage(null)).toBeNull();
    expect(firstImage(undefined)).toBeNull();
  });
});

describe('computeItemCount', () => {
  it('sums explicit Set sizes directly', () => {
    const selection = new Map<string, SelectionEntry>([
      ['p1', new Set(['v1a', 'v1b'])],
      ['p2', new Set(['v2a'])],
    ]);
    expect(computeItemCount(selection, new Map(), new Map())).toBe(3);
  });

  it('uses the loaded variantCounts entry for a whole-product pick', () => {
    const selection = new Map<string, SelectionEntry>([['p1', 'ALL']]);
    const variantCounts = new Map([['p1', 4]]);
    expect(computeItemCount(selection, variantCounts, new Map())).toBe(4);
  });

  it('falls back to the product list variantCount when variantCounts is not loaded', () => {
    const selection = new Map<string, SelectionEntry>([['p1', 'ALL']]);
    const productMeta = new Map([['p1', makeProduct('p1', { variantCount: 3 })]]);
    expect(computeItemCount(selection, new Map(), productMeta)).toBe(3);
  });

  it('falls back to 1 when neither variantCounts nor productMeta know the product', () => {
    const selection = new Map<string, SelectionEntry>([['p1', 'ALL']]);
    expect(computeItemCount(selection, new Map(), new Map())).toBe(1);
  });

  it('mixes explicit sets and whole-product picks across products', () => {
    const selection = new Map<string, SelectionEntry>([
      ['p1', new Set(['v1a'])],
      ['p2', 'ALL'],
    ]);
    const variantCounts = new Map([['p2', 5]]);
    expect(computeItemCount(selection, variantCounts, new Map())).toBe(6);
  });
});

describe('computeRailGroups', () => {
  it('reports wholeEan as not-loaded with needCount 0 when variant metadata has not arrived yet', () => {
    const selection = new Map<string, SelectionEntry>([['p1', 'ALL']]);
    const productMeta = new Map([['p1', makeProduct('p1')]]);
    const groups = computeRailGroups(selection, productMeta, new Map(), new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0].whole).toBe(true);
    expect(groups[0].wholeEan).toEqual({ loaded: false, needCount: 0 });
    expect(groups[0].selected).toBeNull();
  });

  it('counts variants missing a barcode once variant metadata is loaded', () => {
    const selection = new Map<string, SelectionEntry>([['p1', 'ALL']]);
    const productMeta = new Map([['p1', makeProduct('p1')]]);
    const variantMeta = new Map([
      [
        'p1',
        [
          makeVariant('v1a', { ean: '111' }),
          makeVariant('v1b', { ean: null, gtin: null }),
          makeVariant('v1c', { ean: null, gtin: null }),
        ],
      ],
    ]);
    const groups = computeRailGroups(selection, productMeta, variantMeta, new Map());
    expect(groups[0].wholeEan).toEqual({ loaded: true, needCount: 2 });
  });

  it('reports per-variant hasBarcode for a variant-subset pick', () => {
    const selection = new Map<string, SelectionEntry>([['p1', new Set(['v1a', 'v1b'])]]);
    const productMeta = new Map([['p1', makeProduct('p1')]]);
    const variantMeta = new Map([
      ['p1', [makeVariant('v1a', { ean: '111' }), makeVariant('v1b', { ean: null, gtin: null })]],
    ]);
    const groups = computeRailGroups(selection, productMeta, variantMeta, new Map());
    expect(groups[0].whole).toBe(false);
    expect(groups[0].selected).toEqual([
      { id: 'v1a', label: 'v1a', hasBarcode: true },
      { id: 'v1b', label: 'v1b', hasBarcode: false },
    ]);
  });

  it('defaults hasBarcode to true for a selected variant not found in loaded metadata', () => {
    const selection = new Map<string, SelectionEntry>([['p1', new Set(['unknown-variant'])]]);
    const productMeta = new Map([['p1', makeProduct('p1')]]);
    const variantMeta = new Map([['p1', [makeVariant('v1a', { ean: null, gtin: null })]]]);
    const groups = computeRailGroups(selection, productMeta, variantMeta, new Map());
    expect(groups[0].selected).toEqual([
      { id: 'unknown-variant', label: 'unknown-variant', hasBarcode: true },
    ]);
  });

  it('falls back to the raw productId as the display name when productMeta is missing', () => {
    const selection = new Map<string, SelectionEntry>([['p-unknown', 'ALL']]);
    const groups = computeRailGroups(selection, new Map(), new Map(), new Map());
    expect(groups[0].name).toBe('p-unknown');
    expect(groups[0].imageSrc).toBeNull();
  });
});

describe('computeNeedEanCount', () => {
  it('sums missing-barcode variants across whole-product and subset groups', () => {
    const railGroups: RailGroup[] = [
      {
        productId: 'p1',
        name: 'Product p1',
        imageSrc: null,
        whole: true,
        totalVariants: 2,
        wholeEan: { loaded: true, needCount: 1 },
        selected: null,
      },
      {
        productId: 'p2',
        name: 'Product p2',
        imageSrc: null,
        whole: false,
        totalVariants: 2,
        wholeEan: null,
        selected: [
          { id: 'v2a', label: 'v2a', hasBarcode: false },
          { id: 'v2b', label: 'v2b', hasBarcode: true },
        ],
      },
    ];
    const variantMeta = new Map([
      ['p1', [makeVariant('v1a', { ean: null, gtin: null }), makeVariant('v1b', { ean: '1' })]],
    ]);
    // Whole-product group (p1) recomputes from loaded variantMeta: 1 missing.
    // Subset group (p2) reads its own `selected.hasBarcode` flags: 1 missing.
    expect(computeNeedEanCount(railGroups, variantMeta)).toBe(2);
  });

  it('returns 0 when every variant has a barcode', () => {
    const railGroups: RailGroup[] = [
      {
        productId: 'p1',
        name: 'Product p1',
        imageSrc: null,
        whole: false,
        totalVariants: 1,
        wholeEan: null,
        selected: [{ id: 'v1a', label: 'v1a', hasBarcode: true }],
      },
    ];
    expect(computeNeedEanCount(railGroups, new Map())).toBe(0);
  });
});
