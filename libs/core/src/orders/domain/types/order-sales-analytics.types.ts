/**
 * Order Sales Analytics Types
 *
 * Shapes for the `/analytics` sales & channel aggregates read (#1987) — the
 * KPI-strip / by-channel-table backend behind `IOrderRecordService.
 * getSalesAndChannelAnalytics`. Built on top of the #1985 read model
 * (`order_records.placedAt/totalAmount/cancelledAt`, `order_line_items`).
 *
 * Currency correctness (#2049/ADR-040 follow-up): `revenue`/`averageOrderValue`/
 * `medianOrderValue` are computed only from orders whose `reportingCurrency`
 * stamp has landed — SUM(reportingTotalAmount), one comparable currency.
 * `unconvertedCount`/`unconvertedValue` disclose orders in range that have no
 * stamp yet (pre-#2049 history, or a stamp still in flight) rather than
 * silently omitting them or silently mixing their native-currency amount into
 * `revenue`. `unconvertedValue` itself sums each order's own native
 * `totalAmount` and MAY mix currencies — it is informational only, never a
 * KPI. `cancelledValue` follows the same currency-safe split as `revenue`
 * (current-era-stamped, cancelled orders only), with the unstamped remainder
 * reported separately as `cancelledUnconvertedCount`/
 * `cancelledUnconvertedValue` (native `totalAmount`, informational, may mix
 * currencies) — it previously summed raw `totalAmount` across every
 * currency in the bucket with no restriction.
 *
 * `cancelledValue` is NET-of-VAT and shipping-EXCLUDED (#2910), per
 * `docs/specs/metrics-analytics-dashboard.md`'s "net value of orders placed
 * in the period with cancelled status" — computed from `order_line_items`
 * (never the shipping-inclusive `reportingTotalAmount`) via the same
 * per-line net-computation machinery Net Sales uses
 * (`resolveNetSalesTaxRate`/`netSalesRateFractionSql`), restricted to
 * cancelled orders whose lines all resolve a tax rate. A cancelled order
 * carrying at least one unresolvable-rate line is excluded from
 * `cancelledValue` and counted instead in
 * `cancelledNetExcludedCount`/`cancelledNetExcludedValue` — the same
 * exclusion-reporting discipline `netExcludedCount`/`netExcludedValue` use
 * for Net Sales, never a silent guessed rate. The cancellation COHORT itself
 * (matching Cancellation Rate's "fully cancelled orders" scope) is
 * unchanged — only the value field's basis changed.
 *
 * Gross/net tax-treatment normalization otherwise remains out of scope — a
 * separate, not-yet-scoped effort.
 *
 * `unconvertedCurrency` labels the `unconvertedValue` figure with the one
 * native currency (`order_records.currency` — a pre-existing #1985 column,
 * never touched by the #2049/ADR-040 FX stamp) shared by every unconverted
 * order in scope, or `null` when that set spans more than one native
 * currency. This is #1987's own scope, not an FX-epic deliverable: the FX
 * epic's job was stamping `reportingCurrency`/`reportingTotalAmount`, which it
 * already did: labelling the *unconverted* evidence with its own native
 * currency is purely an aggregation-query addition on a column the FX epic
 * never touched.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Date-range + optional channel scope for a sales-analytics read.
 * `from` is inclusive, `to` is exclusive — `[from, to)`.
 */
export interface SalesAnalyticsFilters {
  from: Date;
  to: Date;
  sourceConnectionId?: string;
}

/**
 * One raw grouped row from `OrderRecordRepositoryPort.getDailyOrderAggregates`
 * — `order_records` grouped by day (via `placedAt`) and source connection.
 * Internal to the `orders` context: consumed only by the pure aggregation
 * function, never crosses the barrel.
 */
export interface DailyOrderAggregateRow {
  day: Date;
  sourceConnectionId: string;
  /**
   * Non-cancelled orders stamped with the CURRENT system reporting currency
   * (#1987 review notes, ported from #2172's fix for `getTopProductRanking`):
   * a prior-era stamp — one taken while the operator's reporting-currency
   * setting held a different value (#2096) — is folded into
   * `unconvertedCount`/`unconvertedValue` rather than counted here, so a
   * setting change never silently mixes two currencies into one `revenue`.
   */
  orderCount: number;
  /** `SUM(reportingTotalAmount)` over the same current-era stamped, non-cancelled set. */
  revenue: number;
  /** Non-cancelled orders in range with no CURRENT-era `reportingCurrency` stamp. */
  unconvertedCount: number;
  /** Native-currency `SUM(totalAmount)` for `unconvertedCount` — informational, may mix currencies. */
  unconvertedValue: number;
  /**
   * The single native currency shared by every unconverted, non-cancelled
   * order this day/connection, or `null` when that set already mixes
   * currencies. Also `null` when `unconvertedCount` is `0` — the aggregation
   * layer must not read that as "mixed" (see `resolveUniformUnconvertedCurrency`).
   */
  unconvertedCurrency: string | null;
  /** All cancelled orders in range, regardless of FX-stamp state. */
  cancelledCount: number;
  /**
   * VAT-exclusive, shipping-excluded value (#2910) of current-era-stamped,
   * cancelled, net-eligible orders — expressed in `reportingCurrency`. See
   * this file's module doc comment for the full derivation.
   */
  cancelledValue: number;
  /** Cancelled orders in range with no CURRENT-era `reportingCurrency` stamp — not reflected in `cancelledValue`. */
  cancelledUnconvertedCount: number;
  /** Native-currency `SUM(totalAmount)` for `cancelledUnconvertedCount` — informational, may mix currencies, mirrors `unconvertedValue`. */
  cancelledUnconvertedValue: number;
  /**
   * Current-era-stamped, cancelled orders in range excluded from
   * `cancelledValue` — carrying at least one line whose tax rate does not
   * resolve. Mirrors `netExcludedCount` for the cancelled cohort.
   */
  cancelledNetExcludedCount: number;
  /**
   * Native-currency `SUM(totalAmount)` for `cancelledNetExcludedCount` —
   * informational, may mix currencies, mirrors `netExcludedValue`'s
   * convention.
   */
  cancelledNetExcludedValue: number;
  /**
   * The `reportingCurrency` this row's `revenue` (and `cancelledValue`) is expressed in — `null`
   * when every order in the group is unconverted, OR when the stamped orders
   * in this (day, connection) bucket already disagree on `reportingCurrency`
   * (#1987 review, IMPORTANT 1 — an in-flight #2096 restatement can leave two
   * values live at once). Guarded at the repository layer with the same
   * `COUNT(DISTINCT ...) <= 1` pattern as `unconvertedCurrency`, so a mixed
   * bucket is never mislabelled with whichever value happened to sort first.
   */
  reportingCurrency: string | null;
  /**
   * VAT-exclusive counterpart of `revenue` (net-sales tax-rate epic).
   * `SUM` over each order's own lines of `unitPrice * quantity * (1 -
   * rateFraction)`, converted via the same order-level FX multiplier
   * `revenue` uses, restricted to orders that are stamped (the same
   * population `revenue` counts) AND not `taxRateEra = 'pre-rollout'` AND
   * carry a resolvable {@link resolveNetSalesTaxRate} outcome on EVERY line.
   * An order failing any of those is excluded here and counted instead in
   * `netExcludedCount`/`netExcludedValue` — never silently folded into
   * `netRevenue` at a guessed rate, and never double-counted against
   * `unconvertedCount` (that axis is currency, this axis is tax-rate
   * resolvability; the two exclusions are independent and can overlap without
   * either hiding the other).
   */
  netRevenue: number;
  /** Non-cancelled, stamped orders in range excluded from `netRevenue` — pre-rollout or carrying at least one unresolvable-rate line. */
  netExcludedCount: number;
  /** Native-currency `SUM(totalAmount)` for `netExcludedCount` — informational, may mix currencies, mirrors `unconvertedValue`'s convention. */
  netExcludedValue: number;
}

/**
 * Per-connection units-sold split (#1987 review, IMPORTANT 1) — the same
 * current-era-stamped / unconverted split `revenue`/`unconvertedValue` use,
 * so a caller can never divide `orderCount` by a `unitsSold` drawn from a
 * different population. See `OrderLineItemRepositoryPort.getUnitsSoldByConnection`.
 */
export interface ConnectionUnitsSold {
  unitsSold: number;
  unconvertedUnitsSold: number;
}

/**
 * One point of the trend series (revenue + order count only — AOV/median/
 * units carry no trend, per the #1987 scope). Daily for a range no wider than
 * 7 days; for a wider range, resampled into up to 7 contiguous buckets
 * spanning the FULL selected range rather than only its trailing days
 * (#2899) — `date` on a multi-day bucket is that bucket's first covered day.
 */
export interface DailyTrendPoint {
  date: string; // yyyy-mm-dd
  revenue: number;
  orderCount: number;
}

/**
 * Headline (all-channel) sales figures for a date range.
 */
export interface SalesAnalyticsHeadline {
  revenue: number;
  orderCount: number;
  /**
   * `null` when `orderCount` is `0` (#1987 review, IMPORTANT 2) — flattening
   * to `0` made "nothing stamped in range" indistinguishable from a genuine
   * zero AOV, which read as a contradiction next to `medianOrderValue: null`
   * on the same KPI strip.
   */
  averageOrderValue: number | null;
  /**
   * `null` when no stamped order matches the range (the underlying
   * `PERCENTILE_CONT` has no rows to aggregate) — distinct from a genuine
   * zero median (#1987 review, suggestion 2: `revenue`/`averageOrderValue`
   * disambiguate the same "nothing to report" case via `currency: null`;
   * median had no such companion before this, so it flattened both cases to
   * the same `0`).
   */
  medianOrderValue: number | null;
  /**
   * Units sold on orders in the SAME population `revenue`/`orderCount` count
   * — current-era stamped, non-cancelled (#1987 review, IMPORTANT 1). Before
   * this it summed every non-cancelled `order_line_items` row regardless of
   * stamp state, so a deployment with pre-#2049 history could read
   * `orderCount: 0` next to `unitsSold: 340` for the same range.
   */
  unitsSold: number;
  /** Units sold on orders in `unconvertedCount`'s population — the `unitsSold` companion, mirroring `unconvertedCount`/`unconvertedValue`. */
  unconvertedUnitsSold: number;
  /** All cancelled orders in range, regardless of FX-stamp state. */
  cancelledCount: number;
  /** Same meaning as {@link DailyOrderAggregateRow.cancelledValue}, rolled up over the range — expressed in `currency`. */
  cancelledValue: number;
  /** Cancelled orders in range with no CURRENT-era `reportingCurrency` stamp — not reflected in `cancelledValue`. */
  cancelledUnconvertedCount: number;
  /** Native-currency `SUM(totalAmount)` for `cancelledUnconvertedCount` — informational, may mix currencies. */
  cancelledUnconvertedValue: number;
  /** Same meaning as {@link DailyOrderAggregateRow.cancelledNetExcludedCount}, rolled up over the range. */
  cancelledNetExcludedCount: number;
  /** Same meaning as {@link DailyOrderAggregateRow.cancelledNetExcludedValue}, rolled up over the range. */
  cancelledNetExcludedValue: number;
  /**
   * The reporting currency `revenue`/`averageOrderValue`/`medianOrderValue`/
   * `unitsSold` are expressed in. `null` when no order in range has been
   * stamped with the current reporting currency yet (every order falls into
   * `unconvertedCount`/`unconvertedValue`/`unconvertedUnitsSold` instead).
   */
  currency: string | null;
  /** Non-cancelled orders in range with no CURRENT-era `reportingCurrency` stamp — not reflected in `revenue`/`unitsSold`. */
  unconvertedCount: number;
  /** Native-currency sum for `unconvertedCount` — informational, may mix currencies. */
  unconvertedValue: number;
  /**
   * The one native currency `unconvertedValue` is expressed in, or `null`
   * when the unconverted set spans more than one native currency (or
   * `unconvertedCount` is `0` — nothing to label).
   */
  unconvertedCurrency: string | null;
  trend: DailyTrendPoint[];
  /** VAT-exclusive counterpart of `revenue` — see {@link DailyOrderAggregateRow.netRevenue}. */
  netRevenue: number;
  /**
   * `null` when `netOrderCount` (the same population `netRevenue` counts,
   * i.e. `orderCount - netExcludedCount`) is `0` — same "nothing to report"
   * convention as `averageOrderValue`.
   */
  netAverageOrderValue: number | null;
  /** VAT-exclusive counterpart of `medianOrderValue` — `null` on an empty ordered-set, same convention. */
  netMedianOrderValue: number | null;
  /** Same meaning as {@link DailyOrderAggregateRow.netExcludedCount}, rolled up over the range. */
  netExcludedCount: number;
  /** Same meaning as {@link DailyOrderAggregateRow.netExcludedValue}, rolled up over the range. */
  netExcludedValue: number;
}

/**
 * Per-source-connection sales figures. Median is deliberately headline-only
 * (per the #1987 issue's own scope clarification) and therefore absent here.
 */
export interface ChannelSalesAnalytics {
  sourceConnectionId: string;
  revenue: number;
  orderCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.averageOrderValue}, scoped to this channel — `null` when `orderCount` is `0`. */
  averageOrderValue: number | null;
  /** Same meaning as {@link SalesAnalyticsHeadline.unitsSold}, scoped to this channel. */
  unitsSold: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.unconvertedUnitsSold}, scoped to this channel. */
  unconvertedUnitsSold: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledCount}, scoped to this channel. */
  cancelledCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledValue}, scoped to this channel — expressed in `currency`. */
  cancelledValue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledUnconvertedCount}, scoped to this channel. */
  cancelledUnconvertedCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledUnconvertedValue}, scoped to this channel. */
  cancelledUnconvertedValue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledNetExcludedCount}, scoped to this channel. */
  cancelledNetExcludedCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.cancelledNetExcludedValue}, scoped to this channel. */
  cancelledNetExcludedValue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.currency}, scoped to this channel. */
  currency: string | null;
  /** Same meaning as {@link SalesAnalyticsHeadline.unconvertedCount}, scoped to this channel. */
  unconvertedCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.unconvertedValue}, scoped to this channel. */
  unconvertedValue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.unconvertedCurrency}, scoped to this channel. */
  unconvertedCurrency: string | null;
  /**
   * Share of headline revenue, `null` when headline revenue is `0` (#1987
   * review, IMPORTANT 2) — mirrors `averageOrderValue`'s "nothing to report"
   * fix; `0` would have claimed a real 0% share of a headline that itself
   * has nothing to share.
   */
  revenueShare: number | null;
  trend: DailyTrendPoint[];
  /** Same meaning as {@link SalesAnalyticsHeadline.netRevenue}, scoped to this channel. */
  netRevenue: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.netAverageOrderValue}, scoped to this channel. */
  netAverageOrderValue: number | null;
  /** Same meaning as {@link SalesAnalyticsHeadline.netExcludedCount}, scoped to this channel. */
  netExcludedCount: number;
  /** Same meaning as {@link SalesAnalyticsHeadline.netExcludedValue}, scoped to this channel. */
  netExcludedValue: number;
  /**
   * `false` when this channel's oldest ingested order (per
   * `getEarliestOrderDateByConnection`, #2083) postdates the requested range
   * start — i.e. the channel cannot possibly carry data for the full range.
   */
  coverageComplete: boolean;
}

/**
 * Full response shape for `GET /analytics/sales`.
 */
export interface SalesAndChannelAnalytics {
  headline: SalesAnalyticsHeadline;
  channels: ChannelSalesAnalytics[];
}
