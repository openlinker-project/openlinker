/**
 * orderSalesAggregation Unit Tests
 *
 * @module libs/core/src/orders/domain
 */
import { buildSalesAndChannelAnalytics } from './order-sales-aggregation';
import type { DailyOrderAggregateRow, SalesAnalyticsFilters } from './types/order-sales-analytics.types';

describe('orderSalesAggregation', () => {
  const filters = (): SalesAnalyticsFilters => ({
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'), // 7-day range, exclusive
  });

  const row = (overrides: Partial<DailyOrderAggregateRow>): DailyOrderAggregateRow => ({
    day: new Date('2026-08-01T00:00:00.000Z'),
    sourceConnectionId: 'conn-a',
    orderCount: 1,
    revenue: 100,
    cancelledCount: 0,
    cancelledValue: 0,
    ...overrides,
  });

  describe('empty input', () => {
    it('returns an all-zero headline and empty channels for no rows', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline).toEqual({
        revenue: 0,
        orderCount: 0,
        averageOrderValue: 0,
        medianOrderValue: 0,
        unitsSold: 0,
        cancelledCount: 0,
        cancelledValue: 0,
        trend: [
          { date: '2026-08-01', revenue: 0, orderCount: 0 },
          { date: '2026-08-02', revenue: 0, orderCount: 0 },
          { date: '2026-08-03', revenue: 0, orderCount: 0 },
          { date: '2026-08-04', revenue: 0, orderCount: 0 },
          { date: '2026-08-05', revenue: 0, orderCount: 0 },
          { date: '2026-08-06', revenue: 0, orderCount: 0 },
          { date: '2026-08-07', revenue: 0, orderCount: 0 },
        ],
      });
      expect(result.channels).toEqual([]);
    });
  });

  describe('single connection', () => {
    it('computes headline + one channel from a single connection', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ day: new Date('2026-08-01T00:00:00.000Z'), orderCount: 2, revenue: 200 }),
          row({ day: new Date('2026-08-02T00:00:00.000Z'), orderCount: 1, revenue: 50 }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map([['conn-a', 30]]),
        earliestOrderDateByConnection: new Map([['conn-a', new Date('2026-07-01T00:00:00.000Z')]]),
      });

      expect(result.headline.revenue).toBe(250);
      expect(result.headline.orderCount).toBe(3);
      expect(result.headline.averageOrderValue).toBeCloseTo(250 / 3);
      expect(result.headline.medianOrderValue).toBe(100);
      expect(result.headline.unitsSold).toBe(30);

      expect(result.channels).toHaveLength(1);
      expect(result.channels[0]).toMatchObject({
        sourceConnectionId: 'conn-a',
        revenue: 250,
        orderCount: 3,
        unitsSold: 30,
        revenueShare: 1,
        coverageComplete: true,
      });
    });
  });

  describe('multi-connection revenue share', () => {
    it('splits revenueShare proportionally across channels', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ sourceConnectionId: 'conn-a', revenue: 300, orderCount: 3 }),
          row({ sourceConnectionId: 'conn-b', revenue: 100, orderCount: 1 }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([
          ['conn-a', new Date('2026-07-01T00:00:00.000Z')],
          ['conn-b', new Date('2026-07-01T00:00:00.000Z')],
        ]),
      });

      const byId = new Map(result.channels.map((c) => [c.sourceConnectionId, c]));
      expect(byId.get('conn-a')?.revenueShare).toBeCloseTo(0.75);
      expect(byId.get('conn-b')?.revenueShare).toBeCloseTo(0.25);
    });

    it('reports revenueShare of 0 (not NaN) when headline revenue is 0', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ revenue: 0, orderCount: 0 })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([
          ['conn-a', new Date('2026-07-01T00:00:00.000Z')],
        ]),
      });

      expect(result.channels[0].revenueShare).toBe(0);
      expect(Number.isNaN(result.channels[0].revenueShare)).toBe(false);
    });
  });

  describe('cancelled orders', () => {
    it('excludes cancelled totals from revenue/orderCount but reports them separately', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ revenue: 100, orderCount: 1, cancelledCount: 2, cancelledValue: 80 }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.revenue).toBe(100);
      expect(result.headline.orderCount).toBe(1);
      expect(result.headline.cancelledCount).toBe(2);
      expect(result.headline.cancelledValue).toBe(80);
    });

    it('reports 0 average and median (not NaN) when every order in range is cancelled', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ revenue: 0, orderCount: 0, cancelledCount: 3, cancelledValue: 300 })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.averageOrderValue).toBe(0);
      expect(result.headline.medianOrderValue).toBe(0);
      expect(result.headline.cancelledCount).toBe(3);
      expect(result.headline.cancelledValue).toBe(300);
    });
  });

  describe('trend zero-fill', () => {
    it('zero-fills days with no matching rows and keeps exactly 7 points for a 7-day range', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ day: new Date('2026-08-03T00:00:00.000Z'), revenue: 40, orderCount: 1 })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.trend).toHaveLength(7);
      expect(result.headline.trend.map((p) => p.date)).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
        '2026-08-06',
        '2026-08-07',
      ]);
      expect(result.headline.trend.find((p) => p.date === '2026-08-03')).toEqual({
        date: '2026-08-03',
        revenue: 40,
        orderCount: 1,
      });
      expect(result.headline.trend.find((p) => p.date === '2026-08-01')).toEqual({
        date: '2026-08-01',
        revenue: 0,
        orderCount: 0,
      });
    });

    it('trims a longer range to the trailing 7 days, closest to `to`', () => {
      const longFilters: SalesAnalyticsFilters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-31T00:00:00.000Z'), // 30-day range
      };

      const result = buildSalesAndChannelAnalytics({
        filters: longFilters,
        dailyRows: [],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.trend).toHaveLength(7);
      expect(result.headline.trend[0].date).toBe('2026-08-24');
      expect(result.headline.trend[6].date).toBe('2026-08-30');
    });
  });

  describe('coverageComplete', () => {
    it('is true when the earliest order date predates the range start', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({})],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([
          ['conn-a', new Date('2026-01-01T00:00:00.000Z')],
        ]),
      });

      expect(result.channels[0].coverageComplete).toBe(true);
    });

    it('is false when the earliest order date postdates the range start', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({})],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([
          ['conn-a', new Date('2026-08-05T00:00:00.000Z')],
        ]),
      });

      expect(result.channels[0].coverageComplete).toBe(false);
    });

    it('defensively reports false when the map has no entry for a connection present in dailyRows', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({})],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.channels[0].coverageComplete).toBe(false);
    });
  });

  it('never throws on empty maps and zero rows', () => {
    expect(() =>
      buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      })
    ).not.toThrow();
  });
});
