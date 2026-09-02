/**
 * buildVariantSales Unit Tests
 *
 * @module libs/core/src/orders/domain
 */
import { buildVariantSales } from './variant-sales-aggregation';
import type { VariantChannelBreakdownRow, VariantRankingRow } from './types/top-products.types';

describe('buildVariantSales', () => {
  const rankingRow = (overrides: Partial<VariantRankingRow>): VariantRankingRow => ({
    variantId: 'v1',
    units: 10,
    revenue: 100,
    unconvertedRevenue: 0,
    unconvertedOrderCount: 0,
    currency: 'EUR',
    unconvertedCurrency: null,
    netRevenue: 0,
    netExcludedRevenue: 0,
    netExcludedLineCount: 0,
    ...overrides,
  });

  const breakdownRow = (
    overrides: Partial<VariantChannelBreakdownRow>
  ): VariantChannelBreakdownRow => ({
    variantId: 'v1',
    sourceConnectionId: 'conn-a',
    units: 10,
    revenue: 100,
    unconvertedRevenue: 0,
    currency: 'EUR',
    unconvertedCurrency: null,
    netRevenue: 0,
    netExcludedRevenue: 0,
    netExcludedLineCount: 0,
    ...overrides,
  });

  it('returns an empty variants array for no ranking rows', () => {
    const result = buildVariantSales({ productId: 'p1', ranking: [], breakdown: [] });
    expect(result).toEqual({ productId: 'p1', variants: [] });
  });

  it('joins each ranking row to its own breakdown rows by variantId, preserving ranking order', () => {
    const ranking = [rankingRow({ variantId: 'v2' }), rankingRow({ variantId: 'v1' })];
    const breakdown = [
      breakdownRow({ variantId: 'v1', sourceConnectionId: 'conn-a' }),
      breakdownRow({ variantId: 'v1', sourceConnectionId: 'conn-b' }),
      breakdownRow({ variantId: 'v2', sourceConnectionId: 'conn-a' }),
    ];

    const result = buildVariantSales({ productId: 'p1', ranking, breakdown });

    expect(result.productId).toBe('p1');
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0].variantId).toBe('v2');
    expect(result.variants[0].channels).toEqual([
      breakdownRow({ variantId: 'v2', sourceConnectionId: 'conn-a' }),
    ]);
    expect(result.variants[1].variantId).toBe('v1');
    expect(result.variants[1].channels).toEqual([
      breakdownRow({ variantId: 'v1', sourceConnectionId: 'conn-a' }),
      breakdownRow({ variantId: 'v1', sourceConnectionId: 'conn-b' }),
    ]);
  });

  it('joins a null variantId ranking row to its own null-variantId breakdown rows — the "Unassigned" bucket', () => {
    const ranking = [rankingRow({ variantId: null }), rankingRow({ variantId: 'v1' })];
    const breakdown = [
      breakdownRow({ variantId: null, sourceConnectionId: 'conn-a' }),
      breakdownRow({ variantId: 'v1', sourceConnectionId: 'conn-a' }),
    ];

    const result = buildVariantSales({ productId: 'p1', ranking, breakdown });

    const unassigned = result.variants.find((v) => v.variantId === null);
    expect(unassigned).toBeDefined();
    expect(unassigned!.channels).toEqual([breakdownRow({ variantId: null, sourceConnectionId: 'conn-a' })]);
  });

  it('defends against a ranking row with no matching breakdown rows by returning empty channels', () => {
    const ranking = [rankingRow({ variantId: 'v1' })];

    const result = buildVariantSales({ productId: 'p1', ranking, breakdown: [] });

    expect(result.variants).toEqual([
      {
        variantId: 'v1',
        units: 10,
        revenue: 100,
        unconvertedRevenue: 0,
        unconvertedOrderCount: 0,
        currency: 'EUR',
        unconvertedCurrency: null,
        netRevenue: 0,
        netExcludedRevenue: 0,
        netExcludedLineCount: 0,
        channels: [],
      },
    ]);
  });
});
