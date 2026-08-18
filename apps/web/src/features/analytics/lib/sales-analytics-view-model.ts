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

/**
 * Whether a channel's `revenue`/`revenueShare` figures can be rendered as
 * plain money/percentage values, or must render a caveat instead.
 * - `'reporting'` — comparable to headline revenue, in `reportingCurrency`.
 * - `'native'` — a real number, but in the channel's own currency; never
 *   compared against headline revenue (share is always `null` here).
 * - `'unavailable'` — no figure can be honestly given at all.
 */
export function channelRevenueDisplayCurrency(
  channel: ChannelSalesAnalytics,
  reportingCurrency: string
): string | undefined {
  if (channel.revenueBasis === 'reporting') return reportingCurrency;
  if (channel.revenueBasis === 'native') return channel.nativeCurrency ?? undefined;
  return undefined;
}
