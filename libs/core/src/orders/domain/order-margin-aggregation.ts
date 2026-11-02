/**
 * orderMarginAggregation - derive the margin analytics response from raw
 * `order_line_items` margin rows (#3588, D27)
 *
 * Pure derivation (no I/O): `MarginAnalyticsService` reads daily rows grouped
 * by UTC day and source connection, and this folds them into day or ISO-week
 * (UTC, Monday start) buckets, a headline and a per-channel table.
 *
 * Money arithmetic: the repository hands over numeric(…) sums parsed to JS
 * numbers (the same precision the sales aggregation works at). Every sum and
 * derived amount is rounded to 4 decimals (the cost column's own scale) so
 * accumulated binary float noise never reaches a response, and percentages
 * are computed from the rounded sums.
 *
 * Invariant, asserted by the spec rather than at runtime:
 * `coveredNetRevenue + sum(gaps.netAmount) = netRevenue`.
 *
 * @module libs/core/src/orders/domain
 */
import { MarginGapReasonValues, type MarginGapReason } from './order-line-cost-snapshot';
import type {
  MarginAnalytics,
  MarginBucket,
  MarginChannel,
  MarginDailyRow,
  MarginFigures,
  MarginGapSum,
  MarginProductRow,
  MarginProductView,
  MarginSums,
  MarginTrendPoint,
  MarginVariantRow,
  MarginVariantView,
} from './types/order-margin-analytics.types';
import type { SalesAnalyticsFilters } from './types/order-sales-analytics.types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function emptyGaps(): MarginGapSum[] {
  return MarginGapReasonValues.map((reason) => ({ reason, lineCount: 0, netAmount: 0 }));
}

export function emptyMarginSums(): MarginSums {
  return {
    netRevenue: 0,
    coveredNetRevenue: 0,
    costOfGoods: 0,
    gaps: emptyGaps(),
    excludedLineCount: 0,
  };
}

/** Adds `source` into a fresh copy of `target`; gaps are matched by reason, never by position. */
export function addMarginSums(target: MarginSums, source: MarginSums): MarginSums {
  const gapByReason = new Map<MarginGapReason, MarginGapSum>(
    target.gaps.map((gap) => [gap.reason, { ...gap }])
  );
  for (const gap of source.gaps) {
    const current = gapByReason.get(gap.reason) ?? {
      reason: gap.reason,
      lineCount: 0,
      netAmount: 0,
    };
    gapByReason.set(gap.reason, {
      reason: gap.reason,
      lineCount: current.lineCount + gap.lineCount,
      netAmount: roundMoney(current.netAmount + gap.netAmount),
    });
  }
  return {
    netRevenue: roundMoney(target.netRevenue + source.netRevenue),
    coveredNetRevenue: roundMoney(target.coveredNetRevenue + source.coveredNetRevenue),
    costOfGoods: roundMoney(target.costOfGoods + source.costOfGoods),
    gaps: MarginGapReasonValues.map(
      (reason) => gapByReason.get(reason) ?? { reason, lineCount: 0, netAmount: 0 }
    ),
    excludedLineCount: target.excludedLineCount + source.excludedLineCount,
  };
}

/** Derives the margin figure set from additive sums. */
export function toMarginFigures(sums: MarginSums): MarginFigures {
  const netRevenue = roundMoney(sums.netRevenue);
  const coveredNetRevenue = roundMoney(sums.coveredNetRevenue);
  const costOfGoods = roundMoney(sums.costOfGoods);
  const grossMargin = roundMoney(coveredNetRevenue - costOfGoods);
  return {
    netRevenue,
    coveredNetRevenue,
    costOfGoods,
    grossMargin,
    marginPct: coveredNetRevenue === 0 ? null : roundRatio(grossMargin / coveredNetRevenue),
    costCoveragePct: netRevenue === 0 ? null : roundRatio(coveredNetRevenue / netRevenue),
    gaps: MarginGapReasonValues.map((reason) => {
      const gap = sums.gaps.find((candidate) => candidate.reason === reason);
      return {
        reason,
        lineCount: gap?.lineCount ?? 0,
        netAmount: roundMoney(gap?.netAmount ?? 0),
      };
    }),
  };
}

export function buildMarginProductViews(rows: MarginProductRow[]): MarginProductView[] {
  return rows.map((row) => ({ productId: row.productId, ...toMarginFigures(row) }));
}

export function buildMarginVariantViews(rows: MarginVariantRow[]): MarginVariantView[] {
  return rows.map((row) => ({ variantId: row.variantId, ...toMarginFigures(row) }));
}

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC day keys covering `[from, to)`, starting at the UTC day of `from`. */
function enumerateDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let t = start; t < to.getTime(); t += DAY_MS) {
    keys.push(formatDayKey(new Date(t)));
  }
  return keys;
}

/** The ISO-week Monday (UTC) of a `YYYY-MM-DD` day key. */
export function isoWeekStartKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const isoDow = (date.getUTCDay() + 6) % 7; // Monday = 0
  return formatDayKey(new Date(date.getTime() - isoDow * DAY_MS));
}

function bucketKeyOf(dayKey: string, bucket: MarginBucket): string {
  return bucket === 'week' ? isoWeekStartKey(dayKey) : dayKey;
}

export interface BuildMarginAnalyticsInput {
  filters: SalesAnalyticsFilters;
  bucket: MarginBucket;
  dailyRows: MarginDailyRow[];
  currency: string;
}

export function buildMarginAnalytics(input: BuildMarginAnalyticsInput): MarginAnalytics {
  const { filters, bucket, dailyRows, currency } = input;

  const trendSums = new Map<string, MarginSums>();
  for (const dayKey of enumerateDayKeys(filters.from, filters.to)) {
    const key = bucketKeyOf(dayKey, bucket);
    if (!trendSums.has(key)) {
      trendSums.set(key, emptyMarginSums());
    }
  }

  let headline = emptyMarginSums();
  const channelSums = new Map<string, MarginSums>();
  for (const row of dailyRows) {
    headline = addMarginSums(headline, row);

    const key = bucketKeyOf(row.day, bucket);
    trendSums.set(key, addMarginSums(trendSums.get(key) ?? emptyMarginSums(), row));

    channelSums.set(
      row.sourceConnectionId,
      addMarginSums(channelSums.get(row.sourceConnectionId) ?? emptyMarginSums(), row)
    );
  }

  const trend: MarginTrendPoint[] = [...trendSums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, sums]) => ({ date, ...toMarginFigures(sums) }));

  const headlineNet = roundMoney(headline.netRevenue);
  const channels: MarginChannel[] = [...channelSums.entries()]
    .map(([sourceConnectionId, sums]) => ({
      sourceConnectionId,
      ...toMarginFigures(sums),
      revenueShare:
        headlineNet === 0 ? null : roundRatio(roundMoney(sums.netRevenue) / headlineNet),
    }))
    .sort(
      (a, b) =>
        b.netRevenue - a.netRevenue || a.sourceConnectionId.localeCompare(b.sourceConnectionId)
    );

  return {
    currency,
    bucket,
    headline: toMarginFigures(headline),
    trend,
    channels,
    excludedLineCount: headline.excludedLineCount,
  };
}
