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
    unconvertedCount: 0,
    unconvertedValue: 0,
    unconvertedCurrency: null,
    cancelledCount: 0,
    cancelledValue: 0,
    reportingCurrency: 'EUR',
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
        averageOrderValue: null,
        medianOrderValue: null,
        unitsSold: 0,
        unconvertedUnitsSold: 0,
        cancelledCount: 0,
        cancelledValue: 0,
        currency: null,
        unconvertedCount: 0,
        unconvertedValue: 0,
        unconvertedCurrency: null,
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
        unitsByConnection: new Map([['conn-a', { unitsSold: 30, unconvertedUnitsSold: 4 }]]),
        earliestOrderDateByConnection: new Map([['conn-a', new Date('2026-07-01T00:00:00.000Z')]]),
      });

      expect(result.headline.revenue).toBe(250);
      expect(result.headline.orderCount).toBe(3);
      expect(result.headline.averageOrderValue).toBeCloseTo(250 / 3);
      expect(result.headline.medianOrderValue).toBe(100);
      expect(result.headline.unitsSold).toBe(30);
      expect(result.headline.unconvertedUnitsSold).toBe(4);

      expect(result.channels).toHaveLength(1);
      expect(result.channels[0]).toMatchObject({
        sourceConnectionId: 'conn-a',
        revenue: 250,
        orderCount: 3,
        unitsSold: 30,
        unconvertedUnitsSold: 4,
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

    it('reports revenueShare of null (not NaN or 0) when headline revenue is 0 (#1987 review, IMPORTANT 2)', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ revenue: 0, orderCount: 0 })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([
          ['conn-a', new Date('2026-07-01T00:00:00.000Z')],
        ]),
      });

      expect(result.channels[0].revenueShare).toBeNull();
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

    it('reports a null average (not 0 or NaN) and a null median when every order in range is cancelled', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ revenue: 0, orderCount: 0, cancelledCount: 3, cancelledValue: 300 })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      // null, not 0 (#1987 review, IMPORTANT 2) — no stamped order matched
      // the range, distinct from a genuine zero AOV.
      expect(result.headline.averageOrderValue).toBeNull();
      // null, not 0 (#1987 review, suggestion 2) — no stamped order matched
      // the range, distinct from a genuine zero-value median.
      expect(result.headline.medianOrderValue).toBeNull();
      expect(result.headline.cancelledCount).toBe(3);
      expect(result.headline.cancelledValue).toBe(300);
    });

    it('reports cancelled count/value per channel too, not just headline', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            sourceConnectionId: 'conn-a',
            revenue: 100,
            orderCount: 1,
            cancelledCount: 2,
            cancelledValue: 80,
          }),
          row({
            sourceConnectionId: 'conn-b',
            revenue: 50,
            orderCount: 1,
            cancelledCount: 1,
            cancelledValue: 10,
          }),
        ],
        medianOrderValue: 75,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      const byId = new Map(result.channels.map((c) => [c.sourceConnectionId, c]));
      expect(byId.get('conn-a')).toMatchObject({ cancelledCount: 2, cancelledValue: 80 });
      expect(byId.get('conn-b')).toMatchObject({ cancelledCount: 1, cancelledValue: 10 });
      // Per-channel cancelled totals sum back to the headline figure.
      expect(result.headline.cancelledCount).toBe(3);
      expect(result.headline.cancelledValue).toBe(90);
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

  describe('currency correctness (#2049/ADR-040 follow-up)', () => {
    it('reports the stamped currency and rolls up unconverted totals separately', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ sourceConnectionId: 'conn-a', revenue: 100, orderCount: 1, reportingCurrency: 'EUR' }),
          row({
            sourceConnectionId: 'conn-a',
            revenue: 0,
            orderCount: 0,
            unconvertedCount: 2,
            unconvertedValue: 250,
            reportingCurrency: null,
          }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.currency).toBe('EUR');
      expect(result.headline.revenue).toBe(100);
      expect(result.headline.unconvertedCount).toBe(2);
      expect(result.headline.unconvertedValue).toBe(250);
      expect(result.channels[0]).toMatchObject({
        currency: 'EUR',
        unconvertedCount: 2,
        unconvertedValue: 250,
      });
    });

    it('reports a null currency when every row in range is unconverted', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ revenue: 0, orderCount: 0, unconvertedCount: 1, unconvertedValue: 40, reportingCurrency: null }),
        ],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.currency).toBeNull();
      expect(result.channels[0].currency).toBeNull();
    });

    it('reports a null currency (not the first row seen) when rows disagree on reportingCurrency (#1987 review, IMPORTANT 1)', () => {
      // Guards against a first-wins reintroduction: two stamped rows disagree
      // (e.g. an in-flight #2096 restatement), so labelling `revenue` with
      // either one would be a silently wrong sum-plus-label.
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ sourceConnectionId: 'conn-a', revenue: 100, orderCount: 1, reportingCurrency: 'EUR' }),
          row({ sourceConnectionId: 'conn-a', revenue: 100, orderCount: 1, reportingCurrency: 'PLN' }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.currency).toBeNull();
      expect(result.headline.revenue).toBe(200);
      expect(result.channels[0].currency).toBeNull();
    });

    it('does NOT treat a row with zero stamped orders as poisoning the label', () => {
      // A row with orderCount 0 legitimately reports reportingCurrency: null
      // per the repository's own guard — that must not be conflated with an
      // actual disagreement between two stamped rows.
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ sourceConnectionId: 'conn-a', revenue: 100, orderCount: 1, reportingCurrency: 'EUR' }),
          row({
            sourceConnectionId: 'conn-a',
            revenue: 0,
            orderCount: 0,
            unconvertedCount: 1,
            unconvertedValue: 10,
            reportingCurrency: null,
          }),
        ],
        medianOrderValue: 100,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.currency).toBe('EUR');
    });
  });

  describe('unconvertedCurrency (#1987 scope — labels the unconverted evidence, not an FX-epic field)', () => {
    it('labels unconvertedValue with the single native currency shared by every unconverted row', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            day: new Date('2026-08-01T00:00:00.000Z'),
            unconvertedCount: 1,
            unconvertedValue: 40,
            unconvertedCurrency: 'PLN',
          }),
          row({
            day: new Date('2026-08-02T00:00:00.000Z'),
            unconvertedCount: 1,
            unconvertedValue: 60,
            unconvertedCurrency: 'PLN',
          }),
        ],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBe('PLN');
      expect(result.channels[0].unconvertedCurrency).toBe('PLN');
    });

    it('reports null when the unconverted set spans more than one native currency', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            day: new Date('2026-08-01T00:00:00.000Z'),
            unconvertedCount: 1,
            unconvertedValue: 40,
            unconvertedCurrency: 'PLN',
          }),
          row({
            day: new Date('2026-08-02T00:00:00.000Z'),
            unconvertedCount: 1,
            unconvertedValue: 60,
            unconvertedCurrency: 'EUR',
          }),
        ],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBeNull();
      expect(result.channels[0].unconvertedCurrency).toBeNull();
    });

    it('reports null when a single day/connection bucket already mixes currencies', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({ unconvertedCount: 2, unconvertedValue: 100, unconvertedCurrency: null }),
        ],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBeNull();
      expect(result.channels[0].unconvertedCurrency).toBeNull();
    });

    it('does NOT treat a row with zero unconverted orders as poisoning the label (the zero-order-null bug)', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          // Day 1: no unconverted orders at all — its unconvertedCurrency is
          // `null` per the repository's own contract, but that must NOT be
          // read as "mixed" since there's nothing to disagree about.
          row({
            day: new Date('2026-08-01T00:00:00.000Z'),
            unconvertedCount: 0,
            unconvertedValue: 0,
            unconvertedCurrency: null,
          }),
          row({
            day: new Date('2026-08-02T00:00:00.000Z'),
            unconvertedCount: 1,
            unconvertedValue: 50,
            unconvertedCurrency: 'PLN',
          }),
        ],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBe('PLN');
      expect(result.channels[0].unconvertedCurrency).toBe('PLN');
    });

    it('reports null when there is no unconverted evidence at all (nothing to label)', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ unconvertedCount: 0, unconvertedValue: 0, unconvertedCurrency: null })],
        medianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBeNull();
      expect(result.channels[0].unconvertedCurrency).toBeNull();
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
