/**
 * orderMarginAggregation Unit Tests (#3588)
 *
 * @module libs/core/src/orders/domain
 */
import {
  addMarginSums,
  buildMarginAnalytics,
  emptyMarginSums,
  isoWeekStartKey,
  toMarginFigures,
} from './order-margin-aggregation';
import type { MarginDailyRow, MarginGapSum } from './types/order-margin-analytics.types';

function gaps(
  partial: Partial<Record<MarginGapSum['reason'], [number, number]>> = {}
): MarginGapSum[] {
  const reasons = [
    'no-cost',
    'cost-entered-after-sale',
    'no-variant',
    'currency-mismatch',
  ] as const;
  return reasons.map((reason) => ({
    reason,
    lineCount: partial[reason]?.[0] ?? 0,
    netAmount: partial[reason]?.[1] ?? 0,
  }));
}

function row(overrides: Partial<MarginDailyRow>): MarginDailyRow {
  return {
    day: '2026-09-01',
    sourceConnectionId: 'conn-a',
    netRevenue: 0,
    coveredNetRevenue: 0,
    costOfGoods: 0,
    gaps: gaps(),
    excludedLineCount: 0,
    ...overrides,
  };
}

describe('toMarginFigures', () => {
  it('derives margin, margin % and coverage % from the sums', () => {
    const figures = toMarginFigures({
      netRevenue: 200,
      coveredNetRevenue: 150,
      costOfGoods: 90,
      gaps: gaps({ 'no-cost': [2, 50] }),
      excludedLineCount: 0,
    });

    expect(figures.grossMargin).toBe(60);
    expect(figures.marginPct).toBe(0.4);
    expect(figures.costCoveragePct).toBe(0.75);
  });

  it('reports null percentages (never 0) when the denominators are 0', () => {
    const figures = toMarginFigures(emptyMarginSums());

    expect(figures.marginPct).toBeNull();
    expect(figures.costCoveragePct).toBeNull();
    expect(figures.grossMargin).toBe(0);
  });

  it('reports a negative margin when cost exceeds covered revenue', () => {
    const figures = toMarginFigures({
      netRevenue: 50,
      coveredNetRevenue: 50,
      costOfGoods: 60,
      gaps: gaps(),
      excludedLineCount: 0,
    });

    expect(figures.grossMargin).toBe(-10);
    expect(figures.marginPct).toBe(-0.2);
  });

  it('always returns all four gap reasons in the canonical order', () => {
    const figures = toMarginFigures({ ...emptyMarginSums(), gaps: [] });

    expect(figures.gaps.map((gap) => gap.reason)).toEqual([
      'no-cost',
      'cost-entered-after-sale',
      'no-variant',
      'currency-mismatch',
    ]);
  });

  it('does not accumulate float noise (0.1 + 0.2)', () => {
    const sums = addMarginSums(
      { ...emptyMarginSums(), netRevenue: 0.1 },
      { ...emptyMarginSums(), netRevenue: 0.2 }
    );

    expect(sums.netRevenue).toBe(0.3);
  });
});

describe('isoWeekStartKey', () => {
  it('maps every day of an ISO week to its Monday (UTC)', () => {
    // 2026-09-07 is a Monday; 2026-09-13 a Sunday.
    expect(isoWeekStartKey('2026-09-07')).toBe('2026-09-07');
    expect(isoWeekStartKey('2026-09-10')).toBe('2026-09-07');
    expect(isoWeekStartKey('2026-09-13')).toBe('2026-09-07');
    expect(isoWeekStartKey('2026-09-14')).toBe('2026-09-14');
  });

  it('crosses a month and year boundary correctly', () => {
    // 2027-01-01 is a Friday; its ISO Monday is 2026-12-28.
    expect(isoWeekStartKey('2027-01-01')).toBe('2026-12-28');
  });
});

describe('buildMarginAnalytics', () => {
  const filters = {
    from: new Date('2026-09-07T00:00:00.000Z'),
    to: new Date('2026-09-21T00:00:00.000Z'),
  };

  const rows: MarginDailyRow[] = [
    row({
      day: '2026-09-07',
      sourceConnectionId: 'conn-a',
      netRevenue: 100,
      coveredNetRevenue: 60,
      costOfGoods: 36,
      gaps: gaps({ 'no-cost': [1, 40] }),
    }),
    row({
      day: '2026-09-09',
      sourceConnectionId: 'conn-b',
      netRevenue: 80,
      coveredNetRevenue: 0,
      costOfGoods: 0,
      gaps: gaps({ 'cost-entered-after-sale': [1, 50], 'currency-mismatch': [1, 30] }),
      excludedLineCount: 2,
    }),
    row({
      day: '2026-09-15',
      sourceConnectionId: 'conn-a',
      netRevenue: 20,
      coveredNetRevenue: 20,
      costOfGoods: 5,
    }),
  ];

  it('folds the rows into a headline with summed gaps', () => {
    const result = buildMarginAnalytics({
      filters,
      bucket: 'day',
      dailyRows: rows,
      currency: 'PLN',
    });

    expect(result.currency).toBe('PLN');
    expect(result.headline.netRevenue).toBe(200);
    expect(result.headline.coveredNetRevenue).toBe(80);
    expect(result.headline.costOfGoods).toBe(41);
    expect(result.headline.grossMargin).toBe(39);
    expect(result.excludedLineCount).toBe(2);
    expect(result.headline.gaps.find((gap) => gap.reason === 'no-cost')).toEqual({
      reason: 'no-cost',
      lineCount: 1,
      netAmount: 40,
    });
  });

  it('keeps covered + sum(gaps) = netRevenue for the headline, every trend point and every channel', () => {
    const result = buildMarginAnalytics({
      filters,
      bucket: 'week',
      dailyRows: rows,
      currency: 'PLN',
    });

    for (const figures of [result.headline, ...result.trend, ...result.channels]) {
      const gapTotal = figures.gaps.reduce((sum, gap) => sum + gap.netAmount, 0);
      expect(figures.coveredNetRevenue + gapTotal).toBeCloseTo(figures.netRevenue, 4);
    }
  });

  it('zero-fills a daily trend over the whole range', () => {
    const result = buildMarginAnalytics({
      filters,
      bucket: 'day',
      dailyRows: rows,
      currency: 'PLN',
    });

    expect(result.trend).toHaveLength(14);
    expect(result.trend[0].date).toBe('2026-09-07');
    expect(result.trend[1].netRevenue).toBe(0);
    expect(result.trend[1].marginPct).toBeNull();
  });

  it('folds days into ISO weeks (Monday start) for bucket=week', () => {
    const result = buildMarginAnalytics({
      filters,
      bucket: 'week',
      dailyRows: rows,
      currency: 'PLN',
    });

    expect(result.bucket).toBe('week');
    expect(result.trend.map((point) => point.date)).toEqual(['2026-09-07', '2026-09-14']);
    expect(result.trend[0].netRevenue).toBe(180);
    expect(result.trend[1].netRevenue).toBe(20);
  });

  it('buckets a partial first week under its Monday even when the range starts mid-week', () => {
    const result = buildMarginAnalytics({
      filters: {
        from: new Date('2026-09-09T00:00:00.000Z'),
        to: new Date('2026-09-16T00:00:00.000Z'),
      },
      bucket: 'week',
      dailyRows: [
        row({ day: '2026-09-09', netRevenue: 10, coveredNetRevenue: 10, costOfGoods: 4 }),
      ],
      currency: 'PLN',
    });

    expect(result.trend.map((point) => point.date)).toEqual(['2026-09-07', '2026-09-14']);
    expect(result.trend[0].grossMargin).toBe(6);
  });

  it('builds per-channel figures with a revenue share, ordered by net revenue', () => {
    const result = buildMarginAnalytics({
      filters,
      bucket: 'day',
      dailyRows: rows,
      currency: 'PLN',
    });

    expect(result.channels.map((channel) => channel.sourceConnectionId)).toEqual([
      'conn-a',
      'conn-b',
    ]);
    expect(result.channels[0].netRevenue).toBe(120);
    expect(result.channels[0].revenueShare).toBe(0.6);
    expect(result.channels[1].marginPct).toBeNull();
    expect(result.channels[1].costCoveragePct).toBe(0);
  });

  it('degrades to empty figures and null shares for no rows', () => {
    const result = buildMarginAnalytics({ filters, bucket: 'day', dailyRows: [], currency: 'EUR' });

    expect(result.headline.netRevenue).toBe(0);
    expect(result.headline.marginPct).toBeNull();
    expect(result.channels).toEqual([]);
    expect(result.excludedLineCount).toBe(0);
  });
});
