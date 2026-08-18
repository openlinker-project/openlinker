import { describe, expect, it } from 'vitest';
import type { ChannelSalesAnalytics, DailyTrendPoint } from '../api/sales-analytics.types';
import {
  averageDailyOrders,
  cancellationRate,
  channelRevenueDisplayCurrency,
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
    revenueBasis: 'reporting',
    nativeCurrency: null,
    orderCount: 10,
    stampedOrderCount: 10,
    averageOrderValue: 10,
    unitsSold: 20,
    cancelledCount: 0,
    cancelledValue: 0,
    revenueShare: 0.5,
    taxTreatment: 'inclusive',
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

describe('channelRevenueDisplayCurrency', () => {
  it('should use the reporting currency when revenueBasis is reporting', () => {
    expect(channelRevenueDisplayCurrency(channel({ revenueBasis: 'reporting' }), 'PLN')).toBe('PLN');
  });

  it('should use the channel native currency when revenueBasis is native', () => {
    expect(
      channelRevenueDisplayCurrency(
        channel({ revenueBasis: 'native', nativeCurrency: 'EUR' }),
        'PLN'
      )
    ).toBe('EUR');
  });

  it('should return undefined when revenueBasis is unavailable', () => {
    expect(
      channelRevenueDisplayCurrency(channel({ revenueBasis: 'unavailable', revenue: null }), 'PLN')
    ).toBeUndefined();
  });
});
