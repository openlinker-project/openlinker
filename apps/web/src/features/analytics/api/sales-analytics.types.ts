/**
 * Sales analytics types
 *
 * Mirrors `apps/api/src/analytics/http/dto/sales-analytics-*.dto.ts` (#1987).
 * `DailyTrendPoint` carries only `revenue` and `orderCount` — there is no
 * daily series for units, AOV, or cancellations, which is why those figures
 * render without a sparkline on the KPI strip (see `analytics-kpi-strip.tsx`).
 *
 * Currency model (#1987 + #2049/ADR-040 follow-up): there is exactly ONE
 * system-wide reporting currency, never a per-channel native currency.
 * `revenue`/`averageOrderValue`/`medianOrderValue` sum only orders whose
 * `reportingCurrency` stamp has landed — `currency` names which one, and is
 * `null` only when nothing in scope has been stamped yet. `unconvertedCount`/
 * `unconvertedValue` disclose orders excluded from `revenue` because they
 * have no stamp yet (recently ingested, or pre-dating the FX epic);
 * `unconvertedValue` is a native-currency sum, informational only, labelled
 * by `unconvertedCurrency` — `null` when that set itself spans more than one
 * native currency (never assume it matches `currency`). `revenueShare` is
 * always a number (`0` when headline revenue is `0`), since every channel's
 * `revenue` is expressed in the same one currency.
 *
 * @module features/analytics/api
 */
export interface DailyTrendPoint {
  /** yyyy-mm-dd */
  date: string;
  revenue: number;
  orderCount: number;
}

export interface SalesAnalyticsHeadline {
  /** `SUM(reportingTotalAmount)` over stamped, non-cancelled orders — expressed in `currency`. */
  revenue: number;
  /** The reporting currency `revenue`/`averageOrderValue`/`medianOrderValue` are expressed in. `null` when nothing in range has been stamped yet. */
  currency: string | null;
  /** Non-cancelled, stamped orders only — the subset `revenue`/`averageOrderValue` are computed from. */
  orderCount: number;
  averageOrderValue: number;
  medianOrderValue: number;
  unitsSold: number;
  cancelledCount: number;
  /** Native-currency sum — may mix currencies; a secondary figure, not gated behind a stamp. */
  cancelledValue: number;
  /** Non-cancelled orders in range with no reporting-currency stamp yet — not reflected in `revenue`. */
  unconvertedCount: number;
  /** Native-currency sum for `unconvertedCount` — informational only, may mix currencies. */
  unconvertedValue: number;
  /** The one native currency `unconvertedValue` is expressed in; `null` when that set mixes currencies (or `unconvertedCount` is `0`). */
  unconvertedCurrency: string | null;
  trend: DailyTrendPoint[];
}

export interface ChannelSalesAnalytics {
  sourceConnectionId: string;
  /** Same meaning as {@link SalesAnalyticsHeadline.revenue}, scoped to this channel. */
  revenue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.currency}, scoped to this channel — independently nullable. */
  currency: string | null;
  orderCount: number;
  averageOrderValue: number;
  unitsSold: number;
  cancelledCount: number;
  cancelledValue: number;
  unconvertedCount: number;
  unconvertedValue: number;
  unconvertedCurrency: string | null;
  /** Share of headline revenue, `0` when headline revenue is `0` — always comparable, since every channel's `revenue` is in the same `currency`. */
  revenueShare: number;
  trend: DailyTrendPoint[];
  /** `false` when this channel's oldest ingested order postdates the requested range start. */
  coverageComplete: boolean;
}

export interface SalesAndChannelAnalytics {
  headline: SalesAnalyticsHeadline;
  channels: ChannelSalesAnalytics[];
}

export interface SalesAnalyticsFilters {
  /** Range start, inclusive, `yyyy-mm-dd` (matches the toolbar's `date-range.lib.ts`). */
  from: string;
  /** Range end, inclusive, `yyyy-mm-dd` — converted to an exclusive instant before the request is sent, see `sales-analytics.api.ts`. */
  to: string;
  sourceConnectionId?: string;
}
