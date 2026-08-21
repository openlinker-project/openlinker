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
 * KPI. `cancelledCount`/`cancelledValue` are left as pre-existing (native
 * `totalAmount`, unstamped-safe) — a secondary figure, not revisited here.
 * Gross/net tax-treatment normalization remains out of scope — a separate,
 * not-yet-scoped effort.
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
  cancelledCount: number;
  cancelledValue: number;
  /**
   * The `reportingCurrency` this row's `revenue` is expressed in — `null`
   * when every order in the group is unconverted, OR when the stamped orders
   * in this (day, connection) bucket already disagree on `reportingCurrency`
   * (#1987 review, IMPORTANT 1 — an in-flight #2096 restatement can leave two
   * values live at once). Guarded at the repository layer with the same
   * `COUNT(DISTINCT ...) <= 1` pattern as `unconvertedCurrency`, so a mixed
   * bucket is never mislabelled with whichever value happened to sort first.
   */
  reportingCurrency: string | null;
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
 * One point of the 7-day daily trend series (revenue + order count only —
 * AOV/median/units carry no trend, per the #1987 scope).
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
  cancelledCount: number;
  cancelledValue: number;
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
  cancelledCount: number;
  cancelledValue: number;
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
