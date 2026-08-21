/**
 * Sales analytics view-model helpers
 *
 * Pure derivations from `SalesAndChannelAnalytics` (#1987) for the KPI strip
 * and by-channel table. Kept separate from the components so the arithmetic
 * is unit-testable without rendering anything.
 *
 * @module features/analytics/lib
 */
import type { ChannelSalesAnalytics, DailyTrendPoint } from '../api/sales-analytics.types';

export function averageDailyOrders(orderCount: number, from: string, to: string): number {
  const days = Math.max(1, rangeDays(from, to));
  return orderCount / days;
}

/** Inclusive day count between two `yyyy-mm-dd` days — `from === to` is 1 day, never 0. */
export function rangeDays(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

export function unitsPerOrder(unitsSold: number, orderCount: number): number {
  if (orderCount === 0) return 0;
  return unitsSold / orderCount;
}

/** Cancellation rate over ALL placed orders, including the cancelled ones themselves. */
export function cancellationRate(cancelledCount: number, orderCount: number): number {
  const denominator = orderCount + cancelledCount;
  if (denominator === 0) return 0;
  return cancelledCount / denominator;
}

export function revenueTrendValues(trend: DailyTrendPoint[]): number[] {
  return trend.map((point) => point.revenue);
}

export function orderCountTrendValues(trend: DailyTrendPoint[]): number[] {
  return trend.map((point) => point.orderCount);
}

export type TrendTone = 'error' | 'neutral' | 'success';

/** Direction-only tone for a sparkline — first vs. last point, not a statistical trend line. */
export function trendTone(values: readonly number[]): TrendTone {
  if (values.length < 2) return 'neutral';
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return 'success';
  if (last < first) return 'error';
  return 'neutral';
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

export interface ChannelCurrencyTotal {
  /** Always the one system-wide reporting currency — every contributing channel's `revenue` already shares it. */
  currency: string;
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  unitsSold: number;
  revenueShare: number;
}

/**
 * `Total · {currency}` row(s) for the by-channel table — the real, comparable
 * KPI aggregate, since every contributing channel's `revenue` already shares
 * one currency. Emitted whenever at least one channel has a stamped
 * `currency`, regardless of contributor count — a single-channel instance
 * still needs its `Total · {currency}` row.
 *
 * Deliberately does NOT emit a row for `unconvertedCurrency` evidence
 * (#2098 follow-up review): a `Total · {currency} (unconverted)` row reused
 * the same currency label as the real reporting total whenever a channel's
 * not-yet-stamped native currency happened to match the reporting currency
 * (e.g. a domestic-currency channel simply awaiting its first FX-stamp pass)
 * — two same-labelled "Total" rows, computed from unrelated fields
 * (`revenue`/`orderCount` vs `unconvertedValue`/`unconvertedCount`), reading
 * as a contradiction rather than two distinct facts. `countUnconvertedOrders`
 * below is the replacement: a single, currency-agnostic count the caller
 * renders as one plain sentence, never a competing "Total" row.
 */
export function groupChannelTotalsByCurrency(channels: ChannelSalesAnalytics[]): ChannelCurrencyTotal[] {
  const totals: ChannelCurrencyTotal[] = [];

  const reportingCurrency = channels.find((c) => c.currency !== null)?.currency ?? null;
  if (reportingCurrency) {
    const contributing = channels.filter((c) => c.currency === reportingCurrency);
    const revenue = sum(contributing, (c) => c.revenue);
    const orderCount = sum(contributing, (c) => c.orderCount);
    totals.push({
      currency: reportingCurrency,
      revenue,
      orderCount,
      averageOrderValue: orderCount === 0 ? 0 : revenue / orderCount,
      unitsSold: sum(contributing, (c) => c.unitsSold),
      revenueShare: sum(contributing, (c) => c.revenueShare),
    });
  }

  return totals;
}

/**
 * Total count of orders across every channel that have no reporting-currency
 * FX stamp yet (`unconvertedCount`) — a single, currency-agnostic number for
 * the by-channel table's footnote. Deliberately a COUNT only, never a summed
 * amount: `unconvertedValue` is a native-currency figure that may mix
 * currencies across channels, and rendering it as a bare number (no symbol)
 * misrepresents it as a real, comparable total — the same mistake already
 * corrected for the needs-attention "stuck orders" row (#2098 follow-up).
 */
export function countUnconvertedOrders(channels: ChannelSalesAnalytics[]): number {
  return sum(channels, (c) => c.unconvertedCount);
}
