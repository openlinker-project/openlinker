import { describe, expect, it } from 'vitest';
import { deriveProductStaleness } from './product-staleness';
import type { Product } from '../api/products.types';

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'ol_product_1',
    name: 'Test Product',
    sku: 'SKU-1',
    price: 10,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveProductStaleness', () => {
  it('should return null when the product has no stale variants', () => {
    const result = deriveProductStaleness(baseProduct({ variantCount: 3, staleVariantCount: 0 }));

    expect(result).toBeNull();
  });

  it('should return null when the product has no variants at all', () => {
    const result = deriveProductStaleness(baseProduct({ variantCount: 0, staleVariantCount: 0 }));

    expect(result).toBeNull();
  });

  it('should return null when the enrichment fields are absent (pre-#2447 payload)', () => {
    const result = deriveProductStaleness(baseProduct());

    expect(result).toBeNull();
  });

  it('should flag a fully-stale product with an error-tone label', () => {
    const result = deriveProductStaleness(baseProduct({ variantCount: 2, staleVariantCount: 2 }));

    expect(result).toEqual({ isFullyStale: true, tone: 'error', label: 'Deleted at source' });
  });

  it('should flag a partially-stale product with a warning-tone "N of M" label', () => {
    const result = deriveProductStaleness(baseProduct({ variantCount: 3, staleVariantCount: 1 }));

    expect(result).toEqual({
      isFullyStale: false,
      tone: 'warning',
      label: '1 of 3 variants deleted at source',
    });
  });
});
