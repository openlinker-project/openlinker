/**
 * Display Currency Conversion Types
 *
 * Shapes for the `/analytics` display-currency read model (#2458, ADR-064, pending in PR #2485).
 * Two conversion modes back the operator-facing display-currency picker:
 *
 *  - `current-rate`: groups the RAW native `currency`/`totalAmount` figures
 *    the aggregation already reads by distinct native currency and converts
 *    each group at today's rate — never the ADR-040 stamp.
 *  - `order-date`: takes the already-computed `SalesAnalyticsHeadline.revenue`
 *    (in the system's stamped reporting currency) and applies a single
 *    current rate to the whole total.
 *
 * Neither mode reads or writes `order_records.reportingCurrency` /
 * `reportingTotalAmount` — that column is written exactly once, by the
 * ADR-040 stamp service, and this is a read-only display transform layered
 * on top of it, never a second writer.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * The two display-currency conversion modes a caller can request. Kept as an
 * open-ended `as const` union, mirroring `FxRateRule`, so a future mode is one
 * array entry away with no schema change on whatever persists the operator's
 * choice.
 */
export const DISPLAY_CURRENCY_RATE_BASIS_VALUES = ['current-rate', 'order-date'] as const;

export type DisplayCurrencyRateBasis = (typeof DISPLAY_CURRENCY_RATE_BASIS_VALUES)[number];

/** Runtime narrowing for a value read back out of a query param or a settings row. */
export function isDisplayCurrencyRateBasis(value: string): value is DisplayCurrencyRateBasis {
  return (DISPLAY_CURRENCY_RATE_BASIS_VALUES as readonly string[]).includes(value);
}

/**
 * Sentinel `currency` value for a `NativeCurrencyAmount` bucket that sums
 * orders spanning more than one native currency with no single ISO code to
 * label them (`SalesAnalyticsHeadline.unconvertedCurrency === null` while
 * `unconvertedCount > 0`, i.e. real, non-zero money whose currencies the
 * `#1987` read model didn't keep separately). `groupByCurrency` never sends
 * this value to a rate provider — a currency-less bucket has no rate to
 * resolve — and it is unconditionally reported in
 * `CurrentRateConversionResult.unresolvedNativeCurrencies` rather than being
 * silently excluded from `convertedTotal` with no trace at all.
 */
export const MIXED_NATIVE_CURRENCIES_LABEL = 'mixed-currencies';

/**
 * One native-currency amount to fold into a `current-rate` conversion — one
 * entry per order, or one entry per daily-row native-currency bucket. The
 * aggregation's own day/connection grouping is irrelevant here; only the
 * `(currency, amount, count)` triple is read. `currency` may be
 * {@link MIXED_NATIVE_CURRENCIES_LABEL} when the caller cannot label a bucket
 * with one ISO code.
 */
export interface NativeCurrencyAmount {
  readonly currency: string;
  readonly amount: number;
  /**
   * How many orders this amount represents (#2488 review, IMPORTANT 1) — a
   * caller aggregating several orders into one pre-summed bucket (e.g. the
   * controller's per-currency revenue bucket) passes the real order count
   * here, not one entry per order. `groupByCurrency` sums this field rather
   * than counting array entries, so `NativeCurrencyBreakdown.orderCount`
   * reflects true order counts regardless of how coarsely the caller batched
   * its input.
   */
  readonly count: number;
}

/** Input to {@link IDisplayCurrencyConversionService.convertAtCurrentRate}. */
export interface CurrentRateConversionInput {
  readonly amounts: readonly NativeCurrencyAmount[];
  readonly displayCurrency: string;
}

/**
 * Per-native-currency subtotal within a `current-rate` conversion result —
 * backs the mockup's "Summed by each order's own currency: {n} orders in
 * {currency}, …" banner.
 */
export interface NativeCurrencyBreakdown {
  readonly currency: string;
  readonly orderCount: number;
  /** `SUM(amount)` for this currency, in its own native currency — never converted. */
  readonly nativeTotal: number;
  /**
   * `nativeTotal` converted to the requested display currency, or `null` when
   * no rate could be resolved for this currency — the row this currency
   * contributes to {@link CurrentRateConversionResult.unresolvedNativeCurrencies}.
   */
  readonly convertedTotal: number | null;
}

/**
 * Output of a `current-rate` conversion. `unresolvedNativeCurrencies` backs
 * the mockup's `unavailable` state — a currency with no resolvable rate is
 * reported here, never thrown and never silently dropped or defaulted. It may
 * also contain {@link MIXED_NATIVE_CURRENCIES_LABEL}: real, non-zero money
 * from a bucket that spans more than one native currency is reported as
 * unresolved rather than being excluded from `convertedTotal` with no trace.
 */
export interface CurrentRateConversionResult {
  readonly displayCurrency: string;
  /**
   * Sum of every RESOLVED breakdown row's `convertedTotal`. A native currency
   * in `unresolvedNativeCurrencies` contributes nothing to this figure — the
   * total is honest about only what it could actually convert.
   */
  readonly convertedTotal: number;
  readonly breakdown: readonly NativeCurrencyBreakdown[];
  readonly unresolvedNativeCurrencies: readonly string[];
}

/** Input to {@link IDisplayCurrencyConversionService.convertAtOrderDate}. */
export interface OrderDateConversionInput {
  /** The already-computed aggregate figure, in `reportingCurrency` — e.g. `SalesAnalyticsHeadline.revenue`. */
  readonly reportingTotal: number;
  /**
   * `SalesAnalyticsHeadline.currency` (or the per-channel equivalent) —
   * `null` when nothing in range has been stamped yet, in which case there is
   * nothing to convert.
   */
  readonly reportingCurrency: string | null;
  readonly displayCurrency: string;
}

/**
 * Output of an `order-date` conversion.
 *
 * `convertedTotal` is `null` in exactly two cases: `reportingCurrency` was
 * `null` (nothing stamped in range to convert), or a conversion was
 * attempted and no rate could be resolved (`unresolved: true`) — the mockup's
 * `unavailable` state for this mode.
 */
export interface OrderDateConversionResult {
  readonly displayCurrency: string;
  readonly convertedTotal: number | null;
  /** The currency `reportingTotal` was expressed in before conversion, or `null` when `reportingCurrency` was `null`. */
  readonly sourceCurrency: string | null;
  /** `true` only when a rate lookup was attempted and failed — never `true` merely because there was nothing to convert. */
  readonly unresolved: boolean;
}
