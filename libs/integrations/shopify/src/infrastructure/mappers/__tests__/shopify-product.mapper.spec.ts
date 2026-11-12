import type { ShopifyProduct, ShopifyVariant } from '../../../domain/types/shopify-api.types';
import type { ShopifyShopContext } from '../../shop-context/shopify-shop-context.provider';
import {
  mapShopifyProduct,
  mapShopifyVariant,
  shopifyCategoryDirectory,
  shopifyCategoryLookupIds,
  shopifyCategoryPath,
  shopifyGrossFactor,
  shopifyWeightKg,
} from '../shopify-product.mapper';

const GROSS_SHOP: ShopifyShopContext = {
  shopName: 'Dev',
  currencyCode: 'PLN',
  taxesIncluded: true,
  locationGid: 'gid://shopify/Location/1',
  locationName: 'Main',
  shopAddress: null,
};

const MUGS = {
  id: 'gid://shopify/TaxonomyCategory/hg-11-10-5-5',
  name: 'Mugs',
  fullName: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
  ancestorIds: [
    'gid://shopify/TaxonomyCategory/hg',
    'gid://shopify/TaxonomyCategory/hg-11',
    'gid://shopify/TaxonomyCategory/hg-11-10',
    'gid://shopify/TaxonomyCategory/hg-11-10-5',
  ],
};

function variant(overrides: Partial<ShopifyVariant> = {}): ShopifyVariant {
  return {
    id: 'gid://shopify/ProductVariant/11',
    title: 'Default Title',
    sku: 'MUG-1',
    barcode: '5901234123457',
    price: '38.99',
    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
    inventoryItem: { id: 'gid://shopify/InventoryItem/1', tracked: true, measurement: { weight: { value: 350, unit: 'GRAMS' } } },
    media: { nodes: [] },
    ...overrides,
  };
}

function product(variants: ShopifyVariant[], overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 'gid://shopify/Product/7',
    title: 'Mug',
    handle: 'mug',
    descriptionHtml: '<p>Mug</p>',
    status: 'ACTIVE',
    isGiftCard: false,
    vendor: 'OL Seed',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    category: MUGS,
    media: { nodes: [{ image: { url: 'https://cdn.shopify.com/mug.png' } }] },
    variants: { nodes: variants },
    ...overrides,
  };
}

describe('Shopify product mapper', () => {
  it('should map a product without options as a simple product with its gross price, EAN and weight', () => {
    const mapped = mapShopifyProduct(product([variant()]), GROSS_SHOP);
    const mappedVariant = mapShopifyVariant(variant(), 'ol_product_1', GROSS_SHOP);

    expect(mapped).toMatchObject({
      name: 'Mug',
      sku: 'MUG-1',
      price: 38.99,
      currency: 'PLN',
      images: ['https://cdn.shopify.com/mug.png'],
      features: [{ name: 'Vendor', value: 'OL Seed' }],
      weight: 0.35,
    });
    expect(mappedVariant).toMatchObject({
      attributes: null,
      ean: '5901234123457',
      gtin: '5901234123457',
      price: 38.99,
      weightGrams: 350,
      images: null,
    });
  });

  it('should carry options as attributes and the variant picture', () => {
    const black = variant({
      selectedOptions: [
        { name: 'Size', value: '42' },
        { name: 'Color', value: 'Black' },
      ],
      media: { nodes: [{ image: { url: 'https://cdn.shopify.com/black.png' } }] },
    });

    expect(mapShopifyVariant(black, 'p', GROSS_SHOP)).toMatchObject({
      attributes: { Size: '42', Color: 'Black' },
      images: ['https://cdn.shopify.com/black.png'],
    });
  });

  it('should report no price for a shop whose prices exclude tax when the rate is unknown (ADR-077)', () => {
    const netShop = { ...GROSS_SHOP, taxesIncluded: false };

    expect(mapShopifyProduct(product([variant()]), netShop).price).toBeNull();
    expect(mapShopifyVariant(variant(), 'p', netShop).price).toBeUndefined();
  });

  it('should gross up a net price with the known rate, rounded to the cent', () => {
    const netShop = { ...GROSS_SHOP, taxesIncluded: false };

    expect(mapShopifyProduct(product([variant()]), netShop, 1.23).price).toBe(47.96);
    expect(mapShopifyVariant(variant(), 'p', netShop, 1.23).price).toBe(47.96);
  });

  it('should ignore the factor on a shop whose prices include tax', () => {
    expect(mapShopifyVariant(variant(), 'p', GROSS_SHOP, 1.23).price).toBe(38.99);
  });

  it('should leave the product SKU empty when the product has several variants', () => {
    expect(mapShopifyProduct(product([variant(), variant({ id: 'v2', sku: 'MUG-2' })]), GROSS_SHOP).sku).toBeNull();
  });

  it.each([
    [{ value: 1.5, unit: 'KILOGRAMS' as const }, 1.5],
    [{ value: 1, unit: 'POUNDS' as const }, 0.454],
    [{ value: 0, unit: 'GRAMS' as const }, undefined],
  ])('should convert the weight %p to %p kg', (weight, kg) => {
    expect(shopifyWeightKg(weight)).toBe(kg);
  });

  it('should put the leaf first and every ancestor after it, so a mapping on any level resolves (A15)', () => {
    const path = shopifyCategoryPath(MUGS);

    expect(path.map((c) => c.id)).toEqual(['hg', 'hg-11', 'hg-11-10', 'hg-11-10-5', 'hg-11-10-5-5']);
    expect(path[4]).toEqual({ id: 'hg-11-10-5-5', name: 'Mugs', depth: 4, parentId: 'hg-11-10-5' });
    expect(shopifyCategoryLookupIds(path)[0]).toBe('hg-11-10-5-5');
    expect(mapShopifyProduct(product([variant()]), GROSS_SHOP).categories).toEqual([
      'hg-11-10-5-5',
      'hg-11-10-5',
      'hg-11-10',
      'hg-11',
      'hg',
    ]);
  });

  it('should return only the leaf when the name path and the id chain disagree', () => {
    expect(shopifyCategoryPath({ ...MUGS, fullName: 'Mugs' })).toEqual([
      { id: 'hg-11-10-5-5', name: 'Mugs', depth: 0 },
    ]);
  });

  it('should list each used node and its ancestors once in the category directory', () => {
    const directory = shopifyCategoryDirectory([MUGS, MUGS, null]);

    expect(directory).toHaveLength(5);
    expect(directory[0]).toMatchObject({ id: 'hg', depth: 0 });
  });
});

describe('shopifyGrossFactor', () => {
  it('should turn a numeric rate into a multiplier, an exemption into 1 and an unknown rate into null', () => {
    expect(shopifyGrossFactor({ kind: 'resolved', code: '23', countryIso2: 'PL' })).toBeCloseTo(1.23);
    expect(shopifyGrossFactor({ kind: 'resolved', code: '0', countryIso2: 'PL' })).toBe(1);
    expect(shopifyGrossFactor({ kind: 'resolved', code: 'zw', countryIso2: 'PL' })).toBe(1);
    expect(shopifyGrossFactor({ kind: 'unknown', reason: 'ambiguous' })).toBeNull();
    expect(shopifyGrossFactor(null)).toBeNull();
  });
});
