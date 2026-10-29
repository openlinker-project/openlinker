/**
 * Shared fixtures for the missing-cost screens (#3588, M30).
 */
import type {
  CostCoverage,
  CostSummary,
  CostWorklistRow,
} from '../features/products/api/products.types';

export function costCoverage(overrides: Partial<CostCoverage> = {}): CostCoverage {
  return {
    days: 30,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    currency: 'PLN',
    soldVariantCount: 142,
    soldVariantsWithoutCost: 9,
    netSales: 85630,
    netSalesWithoutCost: 7750,
    coveragePct: 88.4,
    notInMarginNetSales: 9890,
    gapByReason: [],
    top3: [
      { variantId: 'v1', productId: 'p1', name: 'A', sku: 'A', attributes: null, netSales: 3000 },
      { variantId: 'v2', productId: 'p2', name: 'B', sku: 'B', attributes: null, netSales: 1500 },
      { variantId: 'v3', productId: 'p3', name: 'C', sku: 'C', attributes: null, netSales: 1200 },
    ],
    top3SharePct: 74,
    productOnlyNetSales: 0,
    ...overrides,
  };
}

export function costSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return { variantsWithoutCost: 146, productsWithoutCost: 61, variantsWithCost: 266, ...overrides };
}

export function worklistRow(overrides: Partial<CostWorklistRow> = {}): CostWorklistRow {
  return {
    variantId: 'ol_variant_1',
    productId: 'ol_product_1',
    productName: 'Filiżanka espresso 90 ml',
    sku: 'FIL-90-CZA',
    attributes: { Colour: 'czarna' },
    netUnitCost: null,
    costCurrency: null,
    costUpdatedAt: null,
    netSales30d: 2846.4,
    units30d: 64,
    soldOn: [{ connectionId: 'c1', platformType: 'allegro', name: 'Allegro' }],
    ...overrides,
  };
}
