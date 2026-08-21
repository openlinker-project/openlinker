import { describe, expect, it } from 'vitest';
import type { ChannelSalesAnalytics, DailyTrendPoint } from '../api/sales-analytics.types';
import {
  averageDailyOrders,
  cancellationRate,
  groupChannelTotalsByCurrency,
  orderCountTrendValues,
  rangeDays,
  revenueTrendValues,
  trendTone,
  unitsPerOrder,
} from './sales-analytics-view-model';

function channel(overrides: Partial<ChannelSalesAnalytics> = {}): ChannelSalesAnalytics {
  return {
    sourceConnectionId: 'conn-1',
    revenue: 100,
    currency: 'PLN',
    orderCount: 10,
    averageOrderValue: 10,
    unitsSold: 20,
    cancelledCount: 0,
    cancelledValue: 0,
    unconvertedCount: 0,
    unconvertedValue: 0,
    unconvertedCurrency: null,
    revenueShare: 0.5,
    trend: [],
    coverageComplete: true,
    ...overrides,
  };
}

describe('rangeDays', () => {
  it('should return 1 when from and to are the same day', () => {
    expect(rangeDays('2026-08-17', '2026-08-17')).toBe(1);
  });

  it('should return an inclusive day count for a multi-day range', () => {
    expect(rangeDays('2026-08-01', '2026-08-07')).toBe(7);
  });
});

describe('averageDailyOrders', () => {
  it('should not divide by zero for a single-day range', () => {
    expect(averageDailyOrders(5, '2026-08-17', '2026-08-17')).toBe(5);
  });
});

describe('unitsPerOrder', () => {
  it('should return 0 when orderCount is 0', () => {
    expect(unitsPerOrder(10, 0)).toBe(0);
  });

  it('should divide units by orders', () => {
    expect(unitsPerOrder(20, 10)).toBe(2);
  });
});

describe('cancellationRate', () => {
  it('should return 0 when there are no orders at all', () => {
    expect(cancellationRate(0, 0)).toBe(0);
  });

  it('should compute the rate over placed + cancelled orders', () => {
    expect(cancellationRate(2, 8)).toBe(0.2);
  });
});

describe('trendTone', () => {
  it('should return neutral for fewer than two points', () => {
    expect(trendTone([5])).toBe('neutral');
  });

  it('should return success when the last point is higher than the first', () => {
    expect(trendTone([1, 2, 3])).toBe('success');
  });

  it('should return error when the last point is lower than the first', () => {
    expect(trendTone([3, 2, 1])).toBe('error');
  });
});

describe('revenueTrendValues / orderCountTrendValues', () => {
  const trend: DailyTrendPoint[] = [
    { date: '2026-08-01', revenue: 100, orderCount: 2 },
    { date: '2026-08-02', revenue: 200, orderCount: 4 },
  ];

  it('should extract the revenue series', () => {
    expect(revenueTrendValues(trend)).toEqual([100, 200]);
  });

  it('should extract the order-count series', () => {
    expect(orderCountTrendValues(trend)).toEqual([2, 4]);
  });
});

describe('groupChannelTotalsByCurrency', () => {
  it('should sum a reporting-currency total across more than one contributing channel', () => {
    const totals = groupChannelTotalsByCurrency([
      channel({ sourceConnectionId: 'a', revenue: 3000, orderCount: 25, unitsSold: 40, revenueShare: 0.6 }),
      channel({ sourceConnectionId: 'b', revenue: 2000, orderCount: 15, unitsSold: 20, revenueShare: 0.4 }),
    ]);

    expect(totals).toEqual([
      {
        currency: 'PLN',
        kind: 'reporting',
        revenue: 5000,
        orderCount: 40,
        averageOrderValue: 125,
        unitsSold: 60,
        revenueShare: 1,
      },
    ]);
  });

  it('should still emit a reporting total for a single contributing channel', () => {
    const totals = groupChannelTotalsByCurrency([
      channel({ revenue: 3000, orderCount: 25, unitsSold: 40, revenueShare: 1 }),
    ]);

    expect(totals).toEqual([
      {
        currency: 'PLN',
        kind: 'reporting',
        revenue: 3000,
        orderCount: 25,
        averageOrderValue: 120,
        unitsSold: 40,
        revenueShare: 1,
      },
    ]);
  });

  it('should emit an unconverted-currency subtotal across more than one contributing channel, separate from the reporting total', () => {
    const totals = groupChannelTotalsByCurrency([
      channel({ sourceConnectionId: 'a', revenue: 3000, orderCount: 25, revenueShare: 1 }),
      channel({
        sourceConnectionId: 'b',
        revenue: 0,
        currency: null,
        orderCount: 0,
        unitsSold: 0,
        revenueShare: 0,
        unconvertedCount: 5,
        unconvertedValue: 500,
        unconvertedCurrency: 'EUR',
      }),
      channel({
        sourceConnectionId: 'c',
        revenue: 0,
        currency: null,
        orderCount: 0,
        unitsSold: 0,
        revenueShare: 0,
        unconvertedCount: 3,
        unconvertedValue: 300,
        unconvertedCurrency: 'EUR',
      }),
    ]);

    expect(totals).toEqual([
      expect.objectContaining({ currency: 'PLN', kind: 'reporting' }),
      {
        currency: 'EUR',
        kind: 'unconverted',
        revenue: 800,
        orderCount: 8,
        averageOrderValue: 100,
        unitsSold: null,
        revenueShare: null,
      },
    ]);
  });

  it('should still emit an unconverted subtotal for a single contributing channel', () => {
    const totals = groupChannelTotalsByCurrency([
      channel({ unconvertedCount: 5, unconvertedValue: 500, unconvertedCurrency: 'EUR' }),
    ]);

    expect(totals.filter((t) => t.kind === 'unconverted')).toEqual([
      {
        currency: 'EUR',
        kind: 'unconverted',
        revenue: 500,
        orderCount: 5,
        averageOrderValue: 100,
        unitsSold: null,
        revenueShare: null,
      },
    ]);
  });
});
