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
  /**
   * VAT-exclusive counterpart of `revenue` (net-sales tax-rate epic) — this
   * is the metrics spec's **NOV** (Net Order Value), not yet its **Net
   * Sales** figure, which additionally subtracts the value of returns. No
   * returns/refund entity exists yet — rendered under the "Net sales" label
   * per the reference design mockup regardless (the NOV-vs-Net-Sales nuance
   * lives in the tooltip, not the header) until that gap closes too.
   * Excludes an order that predates per-line tax rates or carries a line
   * with an unresolvable rate — see
   * `netExcludedCount`/`netExcludedValue`.
   */
  netRevenue: number;
  /** `netRevenue` divided by the net-eligible order count (`orderCount - netExcludedCount`). `0` when that count is `0` — the FE renders that as a gap, mirroring `averageOrderValue`. */
  netAverageOrderValue: number;
  /** VAT-exclusive counterpart of `medianOrderValue`. */
  netMedianOrderValue: number;
  /** Orders excluded from `netRevenue` — pre-rollout history or an unresolvable line-level tax rate. Disjoint from `unconvertedCount` (a currency-stamp exclusion, not a tax-rate one). */
  netExcludedCount: number;
  /** Native-currency sum for `netExcludedCount` — informational only, may mix currencies. */
  netExcludedValue: number;
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
  /** Same meaning as {@link SalesAnalyticsHeadline.netRevenue}, scoped to this channel. */
  netRevenue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.netAverageOrderValue}, scoped to this channel. */
  netAverageOrderValue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.netExcludedCount}, scoped to this channel. */
  netExcludedCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.netExcludedValue}, scoped to this channel. */
  netExcludedValue: number;
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
