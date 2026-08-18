/**
 * Sales analytics types
 *
 * Mirrors `apps/api/src/analytics/http/dto/sales-analytics-*.dto.ts` (#1987).
 * `DailyTrendPoint` carries only `revenue` and `orderCount` — there is no
 * daily series for units, AOV, or cancellations, which is why those figures
 * render without a sparkline on the KPI strip (see `analytics-kpi-strip.tsx`).
 *
 * Currency handling (#1987's own acceptance criteria, closed against the
 * FX-stamp infra from #2049/ADR-040): every money figure that could sum
 * across native currencies is derived from FX-stamped orders only, so it is
 * always expressed in one currency (`reportingCurrency`). `stampedOrderCount`
 * discloses how much of `orderCount` a money figure actually covers — a
 * caller must never assume `revenue` reflects all of `orderCount`. A
 * channel's `revenue` is `null` exactly when `revenueBasis` is
 * `'unavailable'`, and `revenueShare` is `null` whenever `revenueBasis` isn't
 * `'reporting'` — never divide a native-currency or unavailable figure
 * against headline revenue.
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
  /** `SUM(reportingTotalAmount)` over stamped, non-cancelled orders — always in `reportingCurrency`. */
  revenue: number;
  /** The reporting currency `revenue`/`medianOrderValue`/`cancelledValue` are expressed in. */
  reportingCurrency: string;
  /** Every non-cancelled order in range, stamped or not. */
  orderCount: number;
  /** The subset of `orderCount` that `revenue`/`averageOrderValue` are actually computed from. */
  stampedOrderCount: number;
  averageOrderValue: number;
  medianOrderValue: number;
  unitsSold: number;
  cancelledCount: number;
  cancelledValue: number;
  /** `true` when the orders behind this response include both a gross- and a net-asserting order. */
  taxTreatmentMixed: boolean;
  trend: DailyTrendPoint[];
}

export const ChannelRevenueBasisValues = ['reporting', 'native', 'unavailable'] as const;
export type ChannelRevenueBasis = (typeof ChannelRevenueBasisValues)[number];

export const ChannelTaxTreatmentSummaryValues = ['inclusive', 'exclusive', 'mixed', 'unknown'] as const;
export type ChannelTaxTreatmentSummary = (typeof ChannelTaxTreatmentSummaryValues)[number];

export interface ChannelSalesAnalytics {
  sourceConnectionId: string;
  /** `null` exactly when `revenueBasis` is `'unavailable'` — a single figure genuinely cannot be given. */
  revenue: number | null;
  revenueBasis: ChannelRevenueBasis;
  /** Set only when `revenueBasis` is `'native'`. */
  nativeCurrency: string | null;
  /** Every non-cancelled order in range, stamped or not. */
  orderCount: number;
  /** The subset of `orderCount` a `'reporting'`-basis `revenue` is computed from. */
  stampedOrderCount: number;
  averageOrderValue: number;
  unitsSold: number;
  cancelledCount: number;
  cancelledValue: number;
  /** Share of headline revenue. `null` whenever `revenueBasis` isn't `'reporting'`. */
  revenueShare: number | null;
  taxTreatment: ChannelTaxTreatmentSummary;
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
