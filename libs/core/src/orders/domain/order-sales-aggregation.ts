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
 * Currency-mixing detection and gross/net tax-treatment normalization are
 * deliberately out of scope here — see #2049/ADR-040 (currency) and a
 * separate, not-yet-scoped tax-normalization effort. `totalAmount` (via
 * `DailyOrderAggregateRow.revenue`) is summed as-is regardless of currency or
 * tax treatment.
 *
 * @module libs/core/src/orders/domain
 */
import type {
  ChannelSalesAnalytics,
  DailyOrderAggregateRow,
  DailyTrendPoint,
  SalesAnalyticsFilters,
  SalesAndChannelAnalytics,
} from './types/order-sales-analytics.types';

/** Number of trailing days rendered in a trend sparkline. */
const TREND_WINDOW_DAYS = 7;

export interface BuildSalesAndChannelAnalyticsInput {
  filters: SalesAnalyticsFilters;
  dailyRows: DailyOrderAggregateRow[];
  medianOrderValue: number | null;
  unitsByConnection: Map<string, number>;
  earliestOrderDateByConnection: Map<string, Date>;
}

/**
 * Assemble the full sales & channel analytics response from raw rows. Pure
 * function of its arguments only (ADR-011) — no I/O, no framework import.
 */
export function buildSalesAndChannelAnalytics(
  input: BuildSalesAndChannelAnalyticsInput
): SalesAndChannelAnalytics {
  const { filters, dailyRows, medianOrderValue, unitsByConnection, earliestOrderDateByConnection } =
    input;

  const dayKeys = enumerateDayKeys(filters.from, filters.to);

  const headlineRevenue = sum(dailyRows, (r) => r.revenue);
  const headlineOrderCount = sum(dailyRows, (r) => r.orderCount);
  const headlineCancelledCount = sum(dailyRows, (r) => r.cancelledCount);
  const headlineCancelledValue = sum(dailyRows, (r) => r.cancelledValue);
  const headlineUnitsSold = sum([...unitsByConnection.values()], (units) => units);

  const headline = {
    revenue: headlineRevenue,
    orderCount: headlineOrderCount,
    averageOrderValue: headlineOrderCount > 0 ? headlineRevenue / headlineOrderCount : 0,
    medianOrderValue: medianOrderValue ?? 0,
    unitsSold: headlineUnitsSold,
    cancelledCount: headlineCancelledCount,
    cancelledValue: headlineCancelledValue,
    trend: buildTrend(dayKeys, dailyRows),
  };

  const rowsByConnection = groupByConnection(dailyRows);
  const channels: ChannelSalesAnalytics[] = [...rowsByConnection.entries()].map(
    ([sourceConnectionId, rows]) => {
      const revenue = sum(rows, (r) => r.revenue);
      const orderCount = sum(rows, (r) => r.orderCount);
      const earliestOrderDate = earliestOrderDateByConnection.get(sourceConnectionId);

      return {
        sourceConnectionId,
        revenue,
        orderCount,
        averageOrderValue: orderCount > 0 ? revenue / orderCount : 0,
        unitsSold: unitsByConnection.get(sourceConnectionId) ?? 0,
        revenueShare: headlineRevenue > 0 ? revenue / headlineRevenue : 0,
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
 * Zero-filled daily series over every day in `dayKeys`, then trimmed to the
 * trailing {@link TREND_WINDOW_DAYS} days (closest to the range end) for the
 * sparkline. A day with zero rows renders as `{ revenue: 0, orderCount: 0 }`
 * rather than being omitted, so a 7-day window always has exactly 7 points.
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

  const series: DailyTrendPoint[] = dayKeys.map((date) => {
    const point = byDay.get(date);
    return { date, revenue: point?.revenue ?? 0, orderCount: point?.orderCount ?? 0 };
  });

  return series.slice(-TREND_WINDOW_DAYS);
}
