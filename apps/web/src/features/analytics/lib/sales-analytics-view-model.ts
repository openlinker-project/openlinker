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
  currency: string;
  /**
   * `'reporting'` — a real KPI aggregate: every contributing channel's
   * `revenue` is already expressed in this one system-wide currency.
   * `'unconverted'` — an informational subtotal of native-currency evidence
   * that has no FX stamp yet (`unconvertedValue`/`unconvertedCount`) — never
   * part of headline revenue, and never comparable across channels the way
   * a `'reporting'` total is.
   */
  kind: 'reporting' | 'unconverted';
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  /** `null` for an `'unconverted'` total — units aren't split by stamp status, so there is nothing honest to sum here. */
  unitsSold: number | null;
  /** `null` for an `'unconverted'` total — share is only meaningful against headline (reporting-currency) revenue. */
  revenueShare: number | null;
}

/**
 * `Total · {currency}` rows for the by-channel table: one `'reporting'` total
 * (the real, comparable KPI aggregate, all channels' `revenue` already share
 * one currency) plus one `'unconverted'` total per distinct native currency
 * found in channels' `unconvertedCurrency` — informational subtotals of
 * evidence with no FX stamp yet. Emitted for every distinct currency present
 * in the data, regardless of how many channels contribute to it — a single
 * EUR-only shop still needs its `Total · EUR` row.
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
      kind: 'reporting',
      revenue,
      orderCount,
      averageOrderValue: orderCount === 0 ? 0 : revenue / orderCount,
      unitsSold: sum(contributing, (c) => c.unitsSold),
      revenueShare: sum(contributing, (c) => c.revenueShare),
    });
  }

  const unconvertedCurrencies = [
    ...new Set(channels.map((c) => c.unconvertedCurrency).filter((c): c is string => c !== null)),
  ].sort((a, b) => a.localeCompare(b));

  for (const currency of unconvertedCurrencies) {
    const contributing = channels.filter((c) => c.unconvertedCurrency === currency);
    const value = sum(contributing, (c) => c.unconvertedValue);
    const count = sum(contributing, (c) => c.unconvertedCount);
    totals.push({
      currency,
      kind: 'unconverted',
      revenue: value,
      orderCount: count,
      averageOrderValue: count === 0 ? 0 : value / count,
      unitsSold: null,
      revenueShare: null,
    });
  }

  return totals;
}
