/**
 * orderSalesAggregation Unit Tests
 *
 * @module libs/core/src/orders/domain
 */
import { buildSalesAndChannelAnalytics } from './order-sales-aggregation';
import type {
  DailyOrderAggregateRow,
  SalesAnalyticsFilters,
} from './types/order-sales-analytics.types';

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
    cancelledUnconvertedCount: 0,
    cancelledUnconvertedValue: 0,
    cancelledNetExcludedCount: 0,
    cancelledNetExcludedValue: 0,
    reportingCurrency: 'EUR',
    netRevenue: 0,
    netExcludedCount: 0,
    netExcludedValue: 0,
    ...overrides,
  });

  describe('empty input', () => {
    it('returns an all-zero headline and empty channels for no rows', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline).toEqual({
        revenue: 0,
        orderCount: 0,
        averageOrderValue: null,
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsSold: 0,
        unconvertedUnitsSold: 0,
        cancelledCount: 0,
        cancelledValue: 0,
        cancelledUnconvertedCount: 0,
        cancelledUnconvertedValue: 0,
        cancelledNetExcludedCount: 0,
        cancelledNetExcludedValue: 0,
        currency: null,
        unconvertedCount: 0,
        unconvertedValue: 0,
        unconvertedCurrency: null,
        netRevenue: 0,
        netAverageOrderValue: null,
        netExcludedCount: 0,
        netExcludedValue: 0,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([['conn-a', new Date('2026-07-01T00:00:00.000Z')]]),
      });

      expect(result.channels[0].revenueShare).toBeNull();
    });
  });

  describe('cancelled orders', () => {
    it('excludes cancelled totals from revenue/orderCount but reports them separately', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ revenue: 100, orderCount: 1, cancelledCount: 2, cancelledValue: 80 })],
        medianOrderValue: 100,
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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

    it('rolls up cancelledNetExcludedCount/cancelledNetExcludedValue across rows, headline and per channel (#2910)', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            sourceConnectionId: 'conn-a',
            cancelledCount: 2,
            cancelledValue: 70,
            cancelledNetExcludedCount: 1,
            cancelledNetExcludedValue: 30,
          }),
          row({
            sourceConnectionId: 'conn-b',
            cancelledCount: 1,
            cancelledValue: 10,
            cancelledNetExcludedCount: 0,
            cancelledNetExcludedValue: 0,
          }),
        ],
        medianOrderValue: 100,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.cancelledValue).toBe(80);
      expect(result.headline.cancelledNetExcludedCount).toBe(1);
      expect(result.headline.cancelledNetExcludedValue).toBe(30);

      const byId = new Map(result.channels.map((c) => [c.sourceConnectionId, c]));
      expect(byId.get('conn-a')).toMatchObject({
        cancelledNetExcludedCount: 1,
        cancelledNetExcludedValue: 30,
      });
      expect(byId.get('conn-b')).toMatchObject({
        cancelledNetExcludedCount: 0,
        cancelledNetExcludedValue: 0,
      });
    });
  });

  describe('trend zero-fill', () => {
    it('zero-fills days with no matching rows and keeps exactly 7 points for a 7-day range', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ day: new Date('2026-08-03T00:00:00.000Z'), revenue: 40, orderCount: 1 })],
        medianOrderValue: null,
        netMedianOrderValue: null,
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

    it('resamples a longer range into 7 buckets spanning the FULL range, not just its trailing days (#2899)', () => {
      const longFilters: SalesAnalyticsFilters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-31T00:00:00.000Z'), // 30-day range
      };

      const result = buildSalesAndChannelAnalytics({
        filters: longFilters,
        dailyRows: [],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.trend).toHaveLength(7);
      // The first bucket now starts at the range's own `from`, not somewhere
      // 23 days into it — the whole 30-day window is covered, not just its
      // trailing 7 days. (A bucket's `date` is its first covered day, so the
      // last bucket's `date` is 2026-08-26, covering the final 5-day group —
      // 30 days split 7 ways is not evenly divisible, so the trailing group
      // is slightly larger; see `resampleTrend`.)
      expect(result.headline.trend[0].date).toBe('2026-08-01');
      expect(result.headline.trend.at(-1)?.date).toBe('2026-08-26');
    });

    it('reflects orders spread across the full range, not only its last 7 days (#2899)', () => {
      const longFilters: SalesAnalyticsFilters = {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-31T00:00:00.000Z'), // 30-day range
      };

      // One order early in the range (day 2) and one late (day 29) — both
      // fall well outside a naive trailing-7-day trim from `to`.
      const result = buildSalesAndChannelAnalytics({
        filters: longFilters,
        dailyRows: [
          row({ day: new Date('2026-08-02T00:00:00.000Z'), revenue: 500, orderCount: 5 }),
          row({ day: new Date('2026-08-29T00:00:00.000Z'), revenue: 700, orderCount: 7 }),
        ],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.trend).toHaveLength(7);
      const totalRevenue = result.headline.trend.reduce((sum, point) => sum + point.revenue, 0);
      const totalOrders = result.headline.trend.reduce((sum, point) => sum + point.orderCount, 0);
      // Both orders are represented somewhere in the resampled series...
      expect(totalRevenue).toBe(1200);
      expect(totalOrders).toBe(12);
      // ...and they land in DIFFERENT buckets (the early- and late-range
      // orders are far enough apart that a 7-bucket even split can't merge
      // them), so the sparkline actually has more than one non-zero point —
      // this is what "the shape changes across the range" means concretely.
      const nonZeroBuckets = result.headline.trend.filter((point) => point.revenue > 0);
      expect(nonZeroBuckets.length).toBeGreaterThan(1);
    });

    it('keeps daily granularity for a range no wider than 7 days, unbucketed', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(), // 7-day range from the shared fixture above
        dailyRows: [row({ day: new Date('2026-08-05T00:00:00.000Z'), revenue: 10, orderCount: 1 })],
        medianOrderValue: null,
        netMedianOrderValue: null,
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
    });
  });

  describe('currency correctness (#2049/ADR-040 follow-up)', () => {
    it('reports the stamped currency and rolls up unconverted totals separately', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            sourceConnectionId: 'conn-a',
            revenue: 100,
            orderCount: 1,
            reportingCurrency: 'EUR',
          }),
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
        netMedianOrderValue: null,
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
          row({
            revenue: 0,
            orderCount: 0,
            unconvertedCount: 1,
            unconvertedValue: 40,
            reportingCurrency: null,
          }),
        ],
        medianOrderValue: null,
        netMedianOrderValue: null,
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
          row({
            sourceConnectionId: 'conn-a',
            revenue: 100,
            orderCount: 1,
            reportingCurrency: 'EUR',
          }),
          row({
            sourceConnectionId: 'conn-a',
            revenue: 100,
            orderCount: 1,
            reportingCurrency: 'PLN',
          }),
        ],
        medianOrderValue: 100,
        netMedianOrderValue: null,
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
          row({
            sourceConnectionId: 'conn-a',
            revenue: 100,
            orderCount: 1,
            reportingCurrency: 'EUR',
          }),
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.unconvertedCurrency).toBeNull();
      expect(result.channels[0].unconvertedCurrency).toBeNull();
    });

    it('reports null when a single day/connection bucket already mixes currencies', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({ unconvertedCount: 2, unconvertedValue: 100, unconvertedCurrency: null })],
        medianOrderValue: null,
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
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
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([['conn-a', new Date('2026-01-01T00:00:00.000Z')]]),
      });

      expect(result.channels[0].coverageComplete).toBe(true);
    });

    it('is false when the earliest order date postdates the range start', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({})],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map([['conn-a', new Date('2026-08-05T00:00:00.000Z')]]),
      });

      expect(result.channels[0].coverageComplete).toBe(false);
    });

    it('defensively reports false when the map has no entry for a connection present in dailyRows', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [row({})],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.channels[0].coverageComplete).toBe(false);
    });
  });

  describe('net sales (VAT-exclusive)', () => {
    it('rolls up netRevenue/netExcludedCount/netExcludedValue across rows, headline and per channel', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            sourceConnectionId: 'conn-a',
            orderCount: 3,
            revenue: 300,
            netRevenue: 200,
            netExcludedCount: 1,
            netExcludedValue: 100,
          }),
          row({
            sourceConnectionId: 'conn-b',
            orderCount: 2,
            revenue: 200,
            netRevenue: 150,
            netExcludedCount: 0,
            netExcludedValue: 0,
          }),
        ],
        medianOrderValue: 100,
        netMedianOrderValue: 90,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.netRevenue).toBe(350);
      expect(result.headline.netExcludedCount).toBe(1);
      expect(result.headline.netExcludedValue).toBe(100);
      // headlineOrderCount (5) - headlineNetExcludedCount (1) = 4 net-eligible orders
      expect(result.headline.netAverageOrderValue).toBe(350 / 4);
      expect(result.headline.netMedianOrderValue).toBe(90);

      const connA = result.channels.find((c) => c.sourceConnectionId === 'conn-a');
      expect(connA?.netRevenue).toBe(200);
      expect(connA?.netExcludedCount).toBe(1);
      expect(connA?.netExcludedValue).toBe(100);
      // orderCount (3) - netExcludedCount (1) = 2 net-eligible orders
      expect(connA?.netAverageOrderValue).toBe(100);

      const connB = result.channels.find((c) => c.sourceConnectionId === 'conn-b');
      expect(connB?.netExcludedCount).toBe(0);
      expect(connB?.netAverageOrderValue).toBe(75);
    });

    it('reports null netAverageOrderValue when every order in scope is net-excluded', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [
          row({
            orderCount: 2,
            revenue: 200,
            netRevenue: 0,
            netExcludedCount: 2,
            netExcludedValue: 200,
          }),
        ],
        medianOrderValue: 100,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.netAverageOrderValue).toBeNull();
      expect(result.headline.netMedianOrderValue).toBeNull();
      expect(result.channels[0].netAverageOrderValue).toBeNull();
    });

    it('never throws on empty input for the net figures', () => {
      const result = buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      });

      expect(result.headline.netRevenue).toBe(0);
      expect(result.headline.netExcludedCount).toBe(0);
      expect(result.headline.netExcludedValue).toBe(0);
      expect(result.headline.netAverageOrderValue).toBeNull();
    });
  });

  it('never throws on empty maps and zero rows', () => {
    expect(() =>
      buildSalesAndChannelAnalytics({
        filters: filters(),
        dailyRows: [],
        medianOrderValue: null,
        netMedianOrderValue: null,
        unitsByConnection: new Map(),
        earliestOrderDateByConnection: new Map(),
      })
    ).not.toThrow();
  });
});
