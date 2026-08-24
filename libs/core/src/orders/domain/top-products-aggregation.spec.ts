/**
 * buildTopProducts Unit Tests
 *
 * @module libs/core/src/orders/domain
 */
import { buildTopProducts } from './top-products-aggregation';
import type { ProductChannelBreakdownRow, ProductRankingRow } from './types/top-products.types';

describe('buildTopProducts', () => {
  const rankingRow = (overrides: Partial<ProductRankingRow>): ProductRankingRow => ({
    productId: 'p1',
    units: 10,
    revenue: 100,
    unconvertedRevenue: 0,
    unconvertedOrderCount: 0,
    currency: 'EUR',
    unconvertedCurrency: null,
    ...overrides,
  });

  const breakdownRow = (overrides: Partial<ProductChannelBreakdownRow>): ProductChannelBreakdownRow => ({
    productId: 'p1',
    sourceConnectionId: 'conn-a',
    units: 10,
    revenue: 100,
    unconvertedRevenue: 0,
    currency: 'EUR',
    unconvertedCurrency: null,
    ...overrides,
  });

  it('returns an empty result for no ranking rows', () => {
    const result = buildTopProducts({ ranking: [], total: 0, breakdown: [] });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('joins each ranking row to its own breakdown rows by productId, preserving ranking order', () => {
    const ranking = [rankingRow({ productId: 'p2' }), rankingRow({ productId: 'p1' })];
    const breakdown = [
      breakdownRow({ productId: 'p1', sourceConnectionId: 'conn-a' }),
      breakdownRow({ productId: 'p1', sourceConnectionId: 'conn-b' }),
      breakdownRow({ productId: 'p2', sourceConnectionId: 'conn-a' }),
    ];

    const result = buildTopProducts({ ranking, total: 2, breakdown });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].productId).toBe('p2');
    expect(result.items[0].channels).toEqual([
      breakdownRow({ productId: 'p2', sourceConnectionId: 'conn-a' }),
    ]);
    expect(result.items[1].productId).toBe('p1');
    expect(result.items[1].channels).toEqual([
      breakdownRow({ productId: 'p1', sourceConnectionId: 'conn-a' }),
      breakdownRow({ productId: 'p1', sourceConnectionId: 'conn-b' }),
    ]);
  });

  it('defends against a ranking row with no matching breakdown rows by returning empty channels', () => {
    const ranking = [rankingRow({ productId: 'p1' })];

    const result = buildTopProducts({ ranking, total: 1, breakdown: [] });

    expect(result.items).toEqual([
      {
        productId: 'p1',
        units: 10,
        revenue: 100,
        unconvertedRevenue: 0,
        unconvertedOrderCount: 0,
        currency: 'EUR',
        unconvertedCurrency: null,
        channels: [],
      },
    ]);
  });

  it('surfaces unconverted revenue/order count and a null currency for an all-unconverted product', () => {
    const ranking = [
      rankingRow({
        productId: 'p1',
        revenue: 0,
        unconvertedRevenue: 250,
        unconvertedOrderCount: 3,
        currency: null,
      }),
    ];

    const result = buildTopProducts({ ranking, total: 1, breakdown: [] });

    expect(result.items[0].revenue).toBe(0);
    expect(result.items[0].unconvertedRevenue).toBe(250);
    expect(result.items[0].unconvertedOrderCount).toBe(3);
    expect(result.items[0].currency).toBeNull();
  });
});
