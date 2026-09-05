/**
 * orderSalesAggregation — derive the #1987 sales & channel analytics response
 * from raw #1985 read-model rows
 *
 * Pure derivation (no I/O): `OrderRecordService.getSalesAndChannelAnalytics`
 * fetches the three raw reads (daily aggregates, median, units-per-connection)
 * plus the existing per-connection earliest-order-date map (#2083), and this
 * function assembles the final headline + per-channel response shape from
 * them. Never throws — a missing map entry or empty input degrades to a
 * zero-valued / empty result rather than failing the read.
 *
 * Currency correctness (#2049/ADR-040 follow-up): `revenue` (headline and per
 * channel) is `SUM(DailyOrderAggregateRow.revenue)`, itself a
 * `reportingTotalAmount` sum restricted to stamped orders at the repository
 * layer — one comparable currency, never a naive cross-currency sum.
 * `currency` is `null` unless every row with at least one stamped order
 * agrees on the same `reportingCurrency`, via `resolveUniformReportingCurrency`
 * (#1987 review, IMPORTANT 1 — see the type's own doc comment for the one
 * caveat that can make rows disagree: an in-flight #2096 restatement).
 * `unconvertedCount`/
 * `unconvertedValue` roll up the rows' own unconverted totals unchanged — this
 * function does no currency arithmetic of its own. Gross/net tax-treatment
 * normalization remains a separate, not-yet-scoped effort.
 *
 * `unconvertedCurrency` (headline and per channel) labels `unconvertedValue`
 * with the one native currency shared by every unconverted order rolled into
 * it, via `resolveUniformUnconvertedCurrency` — `null` when that set spans
 * more than one native currency. A day/connection bucket with zero
 * unconverted orders reports `unconvertedCurrency: null` at the repository
 * layer too, but that's "nothing to report", not "mixed" — the resolver
 * skips those buckets rather than letting them poison the whole set.
 *
 * @module libs/core/src/orders/domain
 */
import type {
  ChannelSalesAnalytics,
  ConnectionUnitsSold,
  DailyOrderAggregateRow,
  DailyTrendPoint,
  SalesAnalyticsFilters,
  SalesAndChannelAnalytics,
} from './types/order-sales-analytics.types';

/**
 * Maximum number of points rendered in a trend sparkline (#2899). A range no
 * wider than this stays daily (one point per day); a wider range is
 * resampled into exactly this many contiguous buckets spanning the FULL
 * selected range, so the sparkline always reflects the whole window the
 * operator picked rather than only its trailing days. See {@link buildTrend}.
 */
const TREND_BUCKET_COUNT = 7;

export interface BuildSalesAndChannelAnalyticsInput {
  filters: SalesAnalyticsFilters;
  dailyRows: DailyOrderAggregateRow[];
  medianOrderValue: number | null;
  /** VAT-exclusive counterpart of `medianOrderValue` — see `SalesAnalyticsHeadline.netMedianOrderValue`. */
  netMedianOrderValue: number | null;
  unitsByConnection: Map<string, ConnectionUnitsSold>;
  earliestOrderDateByConnection: Map<string, Date>;
}

/**
 * Assemble the full sales & channel analytics response from raw rows. Pure
 * function of its arguments only (ADR-011) — no I/O, no framework import.
 */
export function buildSalesAndChannelAnalytics(
  input: BuildSalesAndChannelAnalyticsInput
): SalesAndChannelAnalytics {
  const {
    filters,
    dailyRows,
    medianOrderValue,
    netMedianOrderValue,
    unitsByConnection,
    earliestOrderDateByConnection,
  } = input;

  const dayKeys = enumerateDayKeys(filters.from, filters.to);

  const headlineRevenue = sum(dailyRows, (r) => r.revenue);
  const headlineOrderCount = sum(dailyRows, (r) => r.orderCount);
  const headlineCancelledCount = sum(dailyRows, (r) => r.cancelledCount);
  const headlineCancelledValue = sum(dailyRows, (r) => r.cancelledValue);
  const headlineCancelledUnconvertedCount = sum(dailyRows, (r) => r.cancelledUnconvertedCount);
  const headlineCancelledUnconvertedValue = sum(dailyRows, (r) => r.cancelledUnconvertedValue);
  const headlineUnitsSold = sum([...unitsByConnection.values()], (row) => row.unitsSold);
  const headlineUnconvertedUnitsSold = sum(
    [...unitsByConnection.values()],
    (row) => row.unconvertedUnitsSold
  );
  const headlineUnconvertedCount = sum(dailyRows, (r) => r.unconvertedCount);
  const headlineUnconvertedValue = sum(dailyRows, (r) => r.unconvertedValue);
  const currency = resolveUniformReportingCurrency(dailyRows);
  const headlineNetRevenue = sum(dailyRows, (r) => r.netRevenue);
  const headlineNetExcludedCount = sum(dailyRows, (r) => r.netExcludedCount);
  const headlineNetExcludedValue = sum(dailyRows, (r) => r.netExcludedValue);
  // Same population `netRevenue` counts: orders in scope minus the ones
  // excluded from net (pre-rollout or unresolvable-rate), never a
  // separately-tracked count that could drift from what was actually summed.
  const headlineNetOrderCount = headlineOrderCount - headlineNetExcludedCount;

  const headline = {
    revenue: headlineRevenue,
    orderCount: headlineOrderCount,
    // `null` when nothing is stamped in range (#1987 review, IMPORTANT 2) —
    // flattening to `0` made "nothing to report" indistinguishable from a
    // genuine zero AOV, which read as a contradiction next to
    // `medianOrderValue: null` on the same KPI strip.
    averageOrderValue: headlineOrderCount > 0 ? headlineRevenue / headlineOrderCount : null,
    // Passed through verbatim, `null` included (#1987 review, suggestion 2) —
    // flattening to `0` made "no stamped order in range" indistinguishable
    // from a genuine zero-value median.
    medianOrderValue,
    unitsSold: headlineUnitsSold,
    unconvertedUnitsSold: headlineUnconvertedUnitsSold,
    cancelledCount: headlineCancelledCount,
    cancelledValue: headlineCancelledValue,
    cancelledUnconvertedCount: headlineCancelledUnconvertedCount,
    cancelledUnconvertedValue: headlineCancelledUnconvertedValue,
    currency,
    unconvertedCount: headlineUnconvertedCount,
    unconvertedValue: headlineUnconvertedValue,
    unconvertedCurrency: resolveUniformUnconvertedCurrency(dailyRows),
    trend: buildTrend(dayKeys, dailyRows),
    netRevenue: headlineNetRevenue,
    netAverageOrderValue:
      headlineNetOrderCount > 0 ? headlineNetRevenue / headlineNetOrderCount : null,
    // Passed through verbatim, `null` included — same "nothing to report"
    // convention as `medianOrderValue`.
    netMedianOrderValue,
    netExcludedCount: headlineNetExcludedCount,
    netExcludedValue: headlineNetExcludedValue,
  };

  const rowsByConnection = groupByConnection(dailyRows);
  const channels: ChannelSalesAnalytics[] = [...rowsByConnection.entries()].map(
    ([sourceConnectionId, rows]) => {
      const revenue = sum(rows, (r) => r.revenue);
      const orderCount = sum(rows, (r) => r.orderCount);
      const earliestOrderDate = earliestOrderDateByConnection.get(sourceConnectionId);
      const units: ConnectionUnitsSold = unitsByConnection.get(sourceConnectionId) ?? {
        unitsSold: 0,
        unconvertedUnitsSold: 0,
      };
      const netRevenue = sum(rows, (r) => r.netRevenue);
      const netExcludedCount = sum(rows, (r) => r.netExcludedCount);
      const netExcludedValue = sum(rows, (r) => r.netExcludedValue);
      const netOrderCount = orderCount - netExcludedCount;

      return {
        sourceConnectionId,
        revenue,
        orderCount,
        averageOrderValue: orderCount > 0 ? revenue / orderCount : null,
        unitsSold: units.unitsSold,
        unconvertedUnitsSold: units.unconvertedUnitsSold,
        cancelledCount: sum(rows, (r) => r.cancelledCount),
        cancelledValue: sum(rows, (r) => r.cancelledValue),
        cancelledUnconvertedCount: sum(rows, (r) => r.cancelledUnconvertedCount),
        cancelledUnconvertedValue: sum(rows, (r) => r.cancelledUnconvertedValue),
        currency: resolveUniformReportingCurrency(rows),
        unconvertedCount: sum(rows, (r) => r.unconvertedCount),
        unconvertedValue: sum(rows, (r) => r.unconvertedValue),
        unconvertedCurrency: resolveUniformUnconvertedCurrency(rows),
        netRevenue,
        netAverageOrderValue: netOrderCount > 0 ? netRevenue / netOrderCount : null,
        netExcludedCount,
        netExcludedValue,
        // `null` when the headline itself has nothing to share (#1987 review,
        // IMPORTANT 2) — `0` would have claimed a real 0% share of a
        // headline revenue that is itself unstamped/empty.
        revenueShare: headlineRevenue > 0 ? revenue / headlineRevenue : null,
        trend: buildTrend(dayKeys, rows),
        // A connection present in `dailyRows` has ingested at least one order
        // in range, so `earliestOrderDateByConnection` should always carry an
        // entry for it (#2083's own contract) — treated as incomplete
        // coverage defensively if that ever isn't the case, rather than
        // throwing or asserting a false "complete" claim.
        coverageComplete: earliestOrderDate != null && earliestOrderDate <= filters.from,
      };
    }
  );

  return { headline, channels };
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * The reporting currency to label a set of rows' `revenue` with (#1987
 * review, IMPORTANT 1) — `null` unless every row carrying at least one
 * stamped order agrees on the same `reportingCurrency`. The repository
 * already guards this within a single (day, connection) bucket (`NULL` when
 * that bucket itself mixes currencies); this mirrors the same "nothing to
 * report" vs. "mixed" distinction {@link resolveUniformUnconvertedCurrency}
 * makes, across the set of rows being summed here. A row with zero stamped
 * orders is skipped rather than treated as poisoning: it can legitimately
 * carry `reportingCurrency: null` per the repository's own guard, and that
 * must not be conflated with an actual disagreement. Rows are otherwise
 * expected to agree (one system-wide reporting currency); see the type's own
 * doc comment for the one case that can violate that — an in-flight #2096
 * restatement.
 */
function resolveUniformReportingCurrency(rows: DailyOrderAggregateRow[]): string | null {
  let currency: string | null = null;
  for (const row of rows) {
    if (row.orderCount === 0) {
      continue;
    }
    if (row.reportingCurrency == null) {
      return null;
    }
    if (currency == null) {
      currency = row.reportingCurrency;
    } else if (currency !== row.reportingCurrency) {
      return null;
    }
  }
  return currency;
}

/**
 * The single native currency shared by every unconverted, non-cancelled
 * order across a set of daily rows — the label for `unconvertedValue`.
 * `null` when two rows disagree, or a single row already reports `null`
 * while still carrying unconverted orders (that day/connection itself mixes
 * currencies). A row with zero unconverted orders is skipped rather than
 * treated as poisoning: the repository reports `unconvertedCurrency: null`
 * for such a row too, but "nothing to report" must not be conflated with
 * "mixed" — the same distinction `resolveUniformNativeCurrency`-shaped
 * helpers elsewhere in the codebase have to make.
 */
function resolveUniformUnconvertedCurrency(rows: DailyOrderAggregateRow[]): string | null {
  let currency: string | null = null;
  for (const row of rows) {
    if (row.unconvertedCount === 0) {
      continue;
    }
    if (row.unconvertedCurrency == null) {
      return null;
    }
    if (currency == null) {
      currency = row.unconvertedCurrency;
    } else if (currency !== row.unconvertedCurrency) {
      return null;
    }
  }
  return currency;
}

function groupByConnection(
  rows: DailyOrderAggregateRow[]
): Map<string, DailyOrderAggregateRow[]> {
  const grouped = new Map<string, DailyOrderAggregateRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.sourceConnectionId);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.sourceConnectionId, [row]);
    }
  }
  return grouped;
}

/**
 * Every UTC day key touched by `[from, to)`, in ascending order. Always at
 * least one day (the controller rejects `to <= from` before this runs).
 */
function enumerateDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  );
  while (cursor.getTime() < to.getTime()) {
    keys.push(toDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Zero-filled daily series over every day in `dayKeys`, resampled to span the
 * FULL selected range (#2899). A day with zero rows renders as
 * `{ revenue: 0, orderCount: 0 }` rather than being omitted, so the series is
 * dense before any resampling happens.
 *
 * Before this, the series was trimmed to the trailing {@link
 * TREND_BUCKET_COUNT} calendar days regardless of how wide `[from, to)`
 * actually was — so a 7d, 30d and 90d selection sharing the same `to` all
 * produced byte-identical trends, and the sparkline never visibly changed
 * when an operator widened the range. A range no wider than {@link
 * TREND_BUCKET_COUNT} days is returned as-is (one point per day, unbucketed —
 * the pre-existing behaviour for the common 7d case). A wider range is
 * resampled into exactly {@link TREND_BUCKET_COUNT} contiguous buckets
 * covering every day in `[from, to)` — see {@link resampleTrend} — each
 * summing the days it covers, so the trend always reflects the operator's
 * whole selection rather than only its last week.
 *
 * The response shape is unchanged (`DailyTrendPoint[]`, same fields): a
 * bucket's `date` is its first covered day. Frontend consumers only read
 * `.revenue`/`.orderCount` off each point (`revenueTrendValues`/
 * `orderCountTrendValues` in `sales-analytics-view-model.ts`) and the
 * `Sparkline` primitive itself is array-length-agnostic, so no DTO or
 * frontend change is required alongside this.
 */
function buildTrend(dayKeys: string[], rows: DailyOrderAggregateRow[]): DailyTrendPoint[] {
  const byDay = new Map<string, { revenue: number; orderCount: number }>();
  for (const row of rows) {
    const key = toDayKey(row.day);
    const existing = byDay.get(key) ?? { revenue: 0, orderCount: 0 };
    existing.revenue += row.revenue;
    existing.orderCount += row.orderCount;
    byDay.set(key, existing);
  }

  const daily: DailyTrendPoint[] = dayKeys.map((date) => {
    const point = byDay.get(date);
    return { date, revenue: point?.revenue ?? 0, orderCount: point?.orderCount ?? 0 };
  });

  if (daily.length <= TREND_BUCKET_COUNT) {
    return daily;
  }

  return resampleTrend(daily, TREND_BUCKET_COUNT);
}

/**
 * Split a dense daily series into `bucketCount` contiguous groups covering
 * every entry exactly once, each summed and labelled with its first day.
 * Group sizes are as even as possible (any two groups differ by at most one
 * day) via the standard `floor(i * n / k)` partition — since this is only
 * called with `daily.length > bucketCount`, every group is guaranteed
 * non-empty.
 */
function resampleTrend(daily: DailyTrendPoint[], bucketCount: number): DailyTrendPoint[] {
  const total = daily.length;
  const buckets: DailyTrendPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor((i * total) / bucketCount);
    const end = Math.floor(((i + 1) * total) / bucketCount);
    const slice = daily.slice(start, end);
    buckets.push({
      date: slice[0].date,
      revenue: sum(slice, (p) => p.revenue),
      orderCount: sum(slice, (p) => p.orderCount),
    });
  }
  return buckets;
}
