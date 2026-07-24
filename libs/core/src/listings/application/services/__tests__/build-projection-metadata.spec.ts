/**
 * Unit tests for buildProjectionMetadata (#1841).
 */
import { buildProjectionMetadata } from '../build-projection-metadata';
import type { Product, ProductVariant } from '@openlinker/core/products';

function product(partial: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Widget',
    sku: 'P-SKU',
    price: 10,
    description: null,
    images: null,
    currency: 'PLN',
    ...partial,
  };
}

function variant(partial: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v1',
    productId: 'p1',
    sku: 'V-SKU',
    attributes: null,
    ean: null,
    gtin: null,
    ...partial,
  };
}

describe('buildProjectionMetadata', () => {
  it('joins variant attribute values into a variant name', () => {
    const md = buildProjectionMetadata(
      product(),
      variant({ attributes: { Color: 'Red', Size: 'M' } }),
      null
    );
    expect(md.variantName).toBe('Red / M');
  });

  it('prefers the variant SKU over the product SKU', () => {
    const md = buildProjectionMetadata(product({ sku: 'P' }), variant({ sku: 'V' }), null);
    expect(md.sku).toBe('V');
  });

  it('falls back to the product SKU when the variant has none', () => {
    const md = buildProjectionMetadata(product({ sku: 'P' }), variant({ sku: null }), null);
    expect(md.sku).toBe('P');
  });

  it('prefers the explicit barcode, then variant ean, then gtin', () => {
    expect(buildProjectionMetadata(product(), variant({ ean: 'E', gtin: 'G' }), 'B').ean).toBe('B');
    expect(buildProjectionMetadata(product(), variant({ ean: 'E', gtin: 'G' }), null).ean).toBe('E');
    expect(buildProjectionMetadata(product(), variant({ ean: null, gtin: 'G' }), null).ean).toBe('G');
  });

  it('derives manufacturer from a well-known product feature (case-insensitive)', () => {
    const md = buildProjectionMetadata(
      product({ features: [{ name: 'Brand', value: 'ACME' }] }),
      variant(),
      null
    );
    expect(md.manufacturer).toBe('ACME');
  });

  it('stringifies weight, preferring the variant weight', () => {
    expect(buildProjectionMetadata(product({ weight: 2 }), variant({ weight: 1.5 }), null).weight).toBe(
      '1.5'
    );
    expect(buildProjectionMetadata(product({ weight: 2 }), variant({ weight: undefined }), null).weight).toBe(
      '2'
    );
  });

  it('omits fields that are absent', () => {
    const md = buildProjectionMetadata(
      product({ sku: null, weight: undefined, features: [] }),
      variant({ sku: null, attributes: null, ean: null, gtin: null, weight: undefined }),
      null
    );
    expect(md.sku).toBeUndefined();
    expect(md.weight).toBeUndefined();
    expect(md.ean).toBeUndefined();
    expect(md.variantName).toBeUndefined();
    expect(md.manufacturer).toBeUndefined();
    expect(md.productName).toBe('Widget');
  });
});
