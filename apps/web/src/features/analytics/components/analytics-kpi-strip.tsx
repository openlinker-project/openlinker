/**
 * Sales KPI strip (#1990)
 *
 * Six-card strip matching the reference design mockup's anatomy: every card
 * the mockup specifies ships, and every figure the mockup assumed but
 * `GET /analytics/sales` (#1987) doesn't return renders as an honest
 * "not available" placeholder rather than a fabricated number — never
 * silently dropped.
 *
 * Real vs. not-yet-real, per card:
 *   - Revenue: the spec's "Net Sales" is NOV (net order value, VAT-exclusive)
 *     minus the value of returns (`docs/specs/metrics-analytics-dashboard.md`
 *     § Net Sales). The net-sales tax-rate epic made NOV real
 *     (`headline.netRevenue`); the still-open returns caveat and the
 *     tax-rate exclusion count (`headline.netExcludedCount` — pre-rollout
 *     orders, or an order with an unresolvable line-level tax rate) live
 *     only in the (i) tooltip's definition, never as a second qualifier row.
 *     Both Net sales and GMV (`headline.revenue`, real, FX-stamped, in
 *     `headline.currency`) always render — one as the primary headline
 *     figure, the other as the qualifier below it — and which one is
 *     primary is driven by `netGrossBasis` (#2908 fix): `'net'` shows Net
 *     sales primary / GMV qualifier; `'gross'` — the DEFAULT, in the prop,
 *     in the settings column and in `analytics-page.tsx`'s resolver — shows
 *     GMV primary / Net sales qualifier, matching the channel/product tables'
 *     own basis-driven primary column (`channel-sales-table.tsx`'s
 *     `revenueLabel`/`revenueOf`). Neither figure is ever hidden — the
 *     toggle only decides which one is labelled and rendered as the
 *     headline.
 *   - Orders, Units: fully real. `headline.orderCount` only counts
 *     FX-stamped orders (ADR-040) — `totalOrders` below adds back `headline.
 *     unconvertedCount` so Orders/Avg. daily/Units per order/Cancellation
 *     rate count every placed order. `headline.unitsSold` carries the same
 *     FX-stamped restriction, but a unit count needs no currency conversion
 *     at all — `totalUnitsSold` below adds back `headline.
 *     unconvertedUnitsSold` unconditionally, so Units sold/Units per order
 *     count every placed, non-cancelled order's units.
 *   - Order value (AOV + median, #2894 fix, basis-wired by #2903): under the
 *     default `netGrossBasis="gross"` this renders `headline.
 *     averageOrderValue`/`medianOrderValue`, byte-identical to #2894's fix —
 *     NOT the VAT-exclusive `netAverageOrderValue`/`netMedianOrderValue`. The
 *     metrics spec requires AOV/Median's numerator and denominator to
 *     "operate on exactly the same set of orders as Number of Orders" — the
 *     net fields are additionally restricted to `netExcludedCount`-eligible
 *     orders (a stored, resolved per-line tax rate; see ADR-063), a
 *     restriction Number of Orders never applies. AOV/Median need only the
 *     order's gross total (`reportingTotalAmount`), so there is no
 *     principled reason to exclude a tax-rate-unresolved order from the
 *     GROSS figure. The ONE restriction kept there is the FX-stamp one — a
 *     currency-denominated average genuinely cannot include an order with no
 *     known amount in the reporting currency, and it is disclosed via the
 *     same `STAMPED_GAP` gap mark as before.
 *
 *     **That restriction is NOT the one the Number-of-Orders card applies,
 *     and the earlier wording here claimed it was** (#2668 review, finding
 *     8). `revenue` is FX-restricted, but the ORDERS card renders
 *     `totalOrders = orderCount + unconvertedCount` — the full cohort — so
 *     AOV's denominator is strictly the stamped subset of what that card
 *     counts, against the spec's "exactly the same set of orders as Number
 *     of Orders". It is nonetheless the only defensible arithmetic
 *     available: an unstamped order contributes a known count and an
 *     UNKNOWN reporting-currency amount, so including it in the denominator
 *     alone would divide a partial numerator by a full denominator and
 *     report an AOV lower than any order in the range. The alternatives are
 *     to suppress AOV entirely whenever `unconvertedCount > 0` (hiding a
 *     figure that is correct for the orders it can see) or to report it
 *     un-annotated (the pre-#2894 state). The divergence is therefore
 *     accepted and DISCLOSED — the gap mark says so on the card, and the
 *     metrics spec carries the same amendment (#2668 review, finding 10).
 *     The fields it reads are `averageOrderValue`/`medianOrderValue`, which
 *     since #2892/#2906 are derived from merchandise-only line amounts and
 *     no longer from `reportingTotalAmount` directly. Under
 *     `netGrossBasis="net"` — an operator's own explicit choice to view the
 *     page net-of-VAT — the card instead reads `netAverageOrderValue`/
 *     `netMedianOrderValue`, whose narrower net-eligible cohort is disclosed
 *     via `netExcludedNote` instead. The Revenue card now ALSO reads this
 *     prop (#2908 fix), for the primary/qualifier swap described above.
 *   - Returns & refunds: no return/refund entity exists anywhere in the
 *     orders domain — fully planned.
 *   - Cancellations: `cancelledCount`/`cancelledValue` are real fields —
 *     rendered as a normal, real card. It is the ONE card whose count and
 *     value cover different cohorts (#2668 review, SUGGESTION 12): the count
 *     is every cancelled order in range, while the value covers only the
 *     stamped ∧ net-eligible subset. The remainder
 *     (`cancelledUnconvertedCount`, `cancelledNetExcludedCount`) is disclosed
 *     by a gap mark on the "Cancelled value" qualifier rather than
 *     reconciled — the two figures genuinely answer different questions.
 *   - Delta ("vs previous period"), on the four cards with a real headline
 *     number (Orders, Order value, Units, Cancellations): a second
 *     `GET /analytics/sales` call over the immediately-preceding period of
 *     the same length (`computePreviousPeriodRange`), refused outright
 *     (never a lopsided comparison) unless that ENTIRE previous window is
 *     covered by ingested order history (`isPreviousPeriodCovered`, keyed
 *     off `GET /analytics/trust`'s per-connection `earliestOrderDate`,
 *     #2083) — see the per-card `deltaFor*` helpers below. Revenue carries
 *     no delta today (confirmed still true by #2908 — nothing here compares
 *     a toggled current figure against a fixed-basis previous one, since
 *     there is no comparison to begin with); Returns & refunds stays
 *     `planned`, so a delta there would compare against nothing real.
 *
 * Currency (#1987/#2049/ADR-040): there is exactly ONE system-wide reporting
 * currency, `headline.currency` — `null` only when nothing in range has been
 * FX-stamped yet, in which case every money figure here falls back to a
 * bare number rather than a fabricated currency. When `headline.
 * unconvertedCount > 0`, the Order value card discloses the gap explicitly
 * instead of implying AOV/median cover every placed order. The Order-value
 * delta additionally refuses to compare when the two periods' stamped
 * currencies disagree (or either is `null`) — a percentage between two
 * different currencies is not a real number.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import { computePreviousPeriodRange, isPreviousPeriodCovered } from '../lib/date-range.lib';
import {
  buildRateProvenanceDefinitions,
  createReportingCurrencyConverter,
  formatAppliedRateLine,
  isCurrencyRecalculating,
  pickInlineAppliedRate,
  resolveReportingCurrencyRate,
} from '../lib/display-currency.lib';
import { AnalyticsInfotip } from './analytics-infotip';
import type { NetGrossBasis } from '../api/analytics-settings.types';
import { resolveEarliestOrderDate } from '../lib/ingestion-trust.lib';
import {
  averageDailyOrders,
  cancellationRate,
  type DeltaDirection,
  deltaGlyphDirection,
  deltaTone,
  orderCountTrendValues,
  percentDelta,
  pointsDelta,
  rangeDays,
  revenueTrendValues,
  trendTone,
  unitsPerOrder,
} from '../lib/sales-analytics-view-model';
import { AnalyticsKpiCard, type AnalyticsKpiDelta } from './analytics-kpi-card';
import { GapMark } from './gap-mark';
import { RecalculatingValue } from './recalculating-value';
import { deriveCoverageRowCopy } from '../lib/data-coverage.lib';
import type {
  AnalyticsCoverage,
  CoverageCategory,
  CoverageCategoryRow,
} from '../api/analytics-coverage.types';

// The metrics spec defines Net Sales as NOV minus the value of returns
// (docs/specs/metrics-analytics-dashboard.md § Net Sales). NOV itself is now
// real (net-sales tax-rate epic); the returns subtraction is the ONE
// remaining, distinct gap (`analyticsKpiStrip.gaps.netSalesReturns`).
const RATIO_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
const PERCENT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
// No sign — the arrow glyph carries direction, matching the design mockup
// ("↑8.7%", never "↑+8.7%"). Formatted from Math.abs(delta).
const DELTA_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
// The GMV qualifier's applied-rate line is a provenance figure - it must be
// checkable (amount × rate reproduces the displayed figure), so it renders
// up to 8 fraction digits, matching the `numeric(18,8)` `rate.rate` column
// (#2788 review). Trailing zeros beyond the source precision still trim.
const RATE_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
};

interface AnalyticsKpiStripProps {
  filters: SalesAnalyticsFilters;
  /** For `earliestOrderDate` coverage-gating the previous-period delta — already fetched at the page level for the trust header, so this never issues its own `GET /analytics/trust` call. */
  connections: ConnectionIngestionTrust[];
  /**
   * The Data Coverage aggregate (#2474 Phase 7), read at the page level —
   * same query key as `AnalyticsDataCoveragePanel`'s own fetch, so this
   * never issues a second `GET /analytics/coverage` call (#2480, epic
   * #2452 Phase 8). `undefined` while still loading, or when the caller
   * never wired coverage in (e.g. an older test) — every `GapMark` below
   * falls back to its pre-Phase-8 generic title in that case.
   */
  coverage?: AnalyticsCoverage;
  /** Opens the matching Data Coverage detail modal — omit to keep every `GapMark` inert. */
  onOpenCategory?: (category: CoverageCategory) => void;
  /**
   * VAT basis for the Order value card's AOV/Median (#2903 — wiring the
   * #2895 toggle). `'gross'` (the default) reads `headline.
   * averageOrderValue`/`medianOrderValue`, byte-identical to this card's
   * pre-#2895 rendering (#2894's fix). `'net'` reads the VAT-exclusive
   * `netAverageOrderValue`/`netMedianOrderValue` instead — a genuinely
   * narrower cohort (net-sales-eligible orders only, see
   * `netExcludedCount`), which is an accepted, disclosed tradeoff of an
   * operator's own explicit choice to view the page net, not a silent
   * population mismatch the way #2894 found and fixed. The Revenue card is
   * deliberately NOT gated on this — it already renders both Net Sales
   * (primary) and GMV (qualifier) unconditionally, so there is nothing for
   * a basis toggle to add there.
   */
  netGrossBasis?: NetGrossBasis;
}

/** Tax categories partition the exclusion set (`TaxCoverageDetectionService`'s classification pass) — the one with the largest `affectedCount` is the category actually causing `netExcludedCount`. Falls back to `'tax-a'` (the remediable one) if all three read zero, which should not happen while `netExcludedVisible` is true. */
function resolveNetExcludedTaxCategory(categories: CoverageCategoryRow[]): CoverageCategoryRow {
  const taxRows = categories.filter(
    (row): row is CoverageCategoryRow & { category: 'tax-a' | 'tax-b' | 'tax-c' } =>
      row.category === 'tax-a' || row.category === 'tax-b' || row.category === 'tax-c'
  );
  const best = taxRows.reduce<CoverageCategoryRow | null>(
    (max, row) => (max === null || row.affectedCount > max.affectedCount ? row : max),
    null
  );
  return best ?? { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] };
}

export function AnalyticsKpiStrip({
  connections,
  filters,
  coverage,
  onOpenCategory,
  netGrossBasis = 'gross',
}: AnalyticsKpiStripProps): ReactElement {
  const query = useSalesAnalyticsQuery(filters);
  const analyticsCopy = useMessages('analytics');
  const copy = analyticsCopy.analyticsKpiStrip;
  const commonCopy = analyticsCopy.common;
  const cards = copy.cards;
  const plural = usePlural();

  // Computed and the second query issued UNCONDITIONALLY, before any early
  // return below — a hook call can never follow a conditional return.
  const earliestOrderDate = resolveEarliestOrderDate(connections, filters.sourceConnectionId);
  const previousRange = computePreviousPeriodRange(filters.from, filters.to);
  const previousCovered = isPreviousPeriodCovered(previousRange.from, earliestOrderDate);
  const previousFilters: SalesAnalyticsFilters = {
    ...filters,
    from: previousRange.from,
    to: previousRange.to,
  };
  const previousQuery = useSalesAnalyticsQuery(previousFilters, { enabled: previousCovered });

  const numberFormat = useNumberFormat();
  const ratioFormat = useNumberFormat(RATIO_FORMAT_OPTIONS);
  const pctFormat = useNumberFormat(PERCENT_FORMAT_OPTIONS);
  const deltaFormat = useNumberFormat(DELTA_FORMAT_OPTIONS);
  const rateFormat = useNumberFormat(RATE_FORMAT_OPTIONS);

  if (query.isLoading) {
    return (
      <LoadingState
        eyebrow={copy.loading.eyebrow}
        title={copy.loading.title}
        message={copy.loading.message}
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title={copy.error.title}
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>{copy.error.retry}</Button>}
      />
    );
  }

  const headline = query.data?.headline;
  if (!headline) {
    return (
      <ErrorState
        title={copy.error.title}
        message={copy.error.noData}
        action={<Button onClick={() => void query.refetch()}>{copy.error.retry}</Button>}
      />
    );
  }

  const revenueTrend = revenueTrendValues(headline.trend);
  const orderTrend = orderCountTrendValues(headline.trend);
  // headline.orderCount only counts FX-stamped orders (ADR-040) — every
  // placed, non-cancelled order also includes the not-yet-stamped ones.
  const totalOrders = headline.orderCount + headline.unconvertedCount;
  const avgDaily = averageDailyOrders(totalOrders, filters.from, filters.to);
  // headline.unitsSold only counts units on FX-stamped orders (ADR-040), the
  // same restriction as orderCount/revenue — a unit count needs no currency
  // conversion, so unlike orders/AOV there is no reason to leave the
  // unconverted units out of the total at all.
  const totalUnitsSold = headline.unitsSold + headline.unconvertedUnitsSold;
  const unitsRatio = unitsPerOrder(totalUnitsSold, totalOrders);
  const cancelRate = cancellationRate(headline.cancelledCount, totalOrders);
  const nativeCurrency = headline.currency ?? undefined;
  const gmvConversion = headline.displayCurrencyConversion;
  const gmvValue =
    gmvConversion && gmvConversion.convertedRevenue !== null
      ? gmvConversion.convertedRevenue
      : headline.revenue;
  const gmvCurrency =
    gmvConversion && gmvConversion.convertedRevenue !== null
      ? gmvConversion.displayCurrency
      : nativeCurrency;
  // Rate provenance for the GMV qualifier (#2778/#2779) — `null` unless the
  // figure was actually converted (never for the unavailable/identity paths,
  // which report no applied rate at all). See `pickInlineAppliedRate`'s own
  // doc for why only an UNAMBIGUOUS single rate ever renders inline.
  const gmvAppliedRates =
    gmvConversion && gmvConversion.convertedRevenue !== null ? gmvConversion.appliedRates : [];
  const gmvInlineRate = pickInlineAppliedRate(gmvAppliedRates);
  const gmvProvenanceDefinitions = buildRateProvenanceDefinitions(
    gmvConversion?.rateBasis ?? 'current-rate',
    gmvAppliedRates,
    rateFormat
  );
  // #2778/#2779: the REAL published rate for `headline.currency ->
  // displayCurrency`, picked out of the exact backend response GMV itself
  // used — never derived by dividing two totals (see `display-currency.
  // lib.ts`'s "REJECTED APPROACH" note for why that failed in production).
  // `netRevenue`/AOV/median/cancelledValue are all denominated in the SAME
  // `headline.currency` bucket `revenue` came from (ADR-040's one
  // system-wide reporting currency invariant), so applying this one rate to
  // each of them is ordinary arithmetic on a real number, not a shortcut.
  // `null` (unresolved, or nothing converted) means every one of them stays
  // native — the same "never guess" discipline as before, just no longer
  // refusing conversion outright.
  const headlineCurrency = headline.currency;
  const reportingRate = resolveReportingCurrencyRate(gmvConversion, headlineCurrency);
  const reportingConverter = createReportingCurrencyConverter(reportingRate, headlineCurrency);
  const currency = reportingRate && gmvConversion ? gmvConversion.displayCurrency : nativeCurrency;
  function convertToDisplay(amount: number): number {
    return reportingConverter.convertToDisplay(amount, headlineCurrency);
  }
  const stampedGapVisible = headline.unconvertedCount > 0;
  const netExcludedVisible = headline.netExcludedCount > 0;
  const netExcludedNote = plural(headline.netExcludedCount, copy.gaps.netExcluded);

  // Currency/tax exclusion `GapMark`s (#2480, epic #2452 Phase 8) — a
  // category-specific title + click-to-open only when the coverage
  // aggregate reports the SAME category as genuinely open; otherwise every
  // one of these falls back to the pre-Phase-8 generic `STAMPED_GAP` text,
  // inert (nothing to open without real coverage data).
  const currencyCoverageRow = coverage?.categories.find(
    (row) => row.category === 'currency' && row.affectedCount > 0
  );
  // A currency recalculation run is actively in flight (operator clicked
  // "Recalculate now" in Data Coverage, or changed the reporting currency).
  // Until now this state was indistinguishable from "genuinely nothing to
  // report" — every revenue/order-value figure just read as a bare `0`
  // (unconverted orders excluded from `revenue`/`netRevenue`), which reads
  // as broken rather than "wait, this is being fixed right now".
  const currencyRecalculating = isCurrencyRecalculating(coverage);
  const currencyGapTitle =
    stampedGapVisible && currencyCoverageRow
      ? deriveCoverageRowCopy(currencyCoverageRow).sub
      : copy.gaps.unconverted;
  const onOpenCurrencyGap =
    stampedGapVisible && currencyCoverageRow && onOpenCategory
      ? () => onOpenCategory('currency')
      : undefined;

  const netExcludedTaxRow =
    netExcludedVisible && coverage ? resolveNetExcludedTaxCategory(coverage.categories) : undefined;
  const netExcludedGapOpen = netExcludedTaxRow !== undefined && netExcludedTaxRow.affectedCount > 0;
  const netExcludedGapTitle = netExcludedTaxRow
    ? deriveCoverageRowCopy(netExcludedTaxRow).sub
    : undefined;
  const onOpenNetExcludedGap =
    netExcludedGapOpen && netExcludedTaxRow && onOpenCategory
      ? () => onOpenCategory(netExcludedTaxRow.category)
      : undefined;
  // Headline Revenue card (#2908 fix): the primary rendered value/label now
  // tracks `netGrossBasis` the same way the channel/product tables do
  // (`revenueLabel` / `revenueOf` there) — under `'gross'`, the DEFAULT,
  // GMV is primary and Net sales is the qualifier; under `'net'` it's the
  // reverse. (`'gross'` is the default in the prop, in the settings column
  // and in `analytics-page.tsx`'s resolver — this comment said `'net'` was,
  // contradicting this file's own header two hundred lines up, and #2668's
  // review caught the header half only.) Both figures still always render —
  // this only swaps which one is primary.
  // Net sales carries the CURRENCY caveat too (#2668 review, BLOCKING 2).
  // `netRevenue` is computed over exactly the same FX-stamped population
  // `revenue` is, so an unstamped slice under-states BOTH — but this label
  // used to mark only on `netExcludedGapOpen`, a TAX-RATE exclusion the code
  // itself documents as disjoint from the currency one. With
  // `unconvertedCount > 0` and `netExcludedCount === 0` — the ordinary shape
  // of an install that has not finished FX-stamping — the primary headline
  // under `netGrossBasis="net"` therefore carried no coverage caveat at all
  // while GMV beside it carried one, for the same underlying gap.
  //
  // The two caveats are APPENDED rather than one overwriting the other: they
  // describe different, independently-open exclusions, so a reader seeing
  // only the tax sentence would conclude the currency gap does not apply.
  // Cancellations card: what `cancelledValue` leaves out relative to
  // `cancelledCount` (#2668 review, SUGGESTION 12). Two independent
  // exclusions, reported together because they land on the same figure.
  const cancelledValueGapVisible =
    headline.cancelledUnconvertedCount > 0 || headline.cancelledNetExcludedCount > 0;
  const cancelledValueGapTitle = [
    headline.cancelledUnconvertedCount > 0
      ? plural(headline.cancelledUnconvertedCount, copy.gaps.cancelledUnconverted)
      : '',
    headline.cancelledNetExcludedCount > 0
      ? plural(headline.cancelledNetExcludedCount, copy.gaps.cancelledNetExcluded)
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const netSalesGapVisible = netExcludedGapOpen || stampedGapVisible;
  function netSalesGapTitle(): string {
    const parts: string[] = [];
    if (netExcludedGapOpen) {
      parts.push(netExcludedGapTitle ?? netExcludedNote);
    }
    if (stampedGapVisible) {
      parts.push(currencyGapTitle);
    }
    return parts.join(' ');
  }
  function renderNetSalesLabel(): ReactElement | string {
    return netSalesGapVisible ? (
      <>
        {commonCopy.netSales}{' '}
        <GapMark
          title={netSalesGapTitle()}
          onActivate={onOpenNetExcludedGap ?? onOpenCurrencyGap}
        />
      </>
    ) : (
      commonCopy.netSales
    );
  }
  const netRevenue = headline.netRevenue;
  function renderNetSalesValue(): ReactElement {
    return currencyRecalculating ? (
      <RecalculatingValue />
    ) : (
      <>{formatAmount(convertToDisplay(netRevenue), currency)}</>
    );
  }
  function renderGmvLabel(): ReactElement | string {
    return stampedGapVisible ? (
      <>
        {commonCopy.gmv} <GapMark title={currencyGapTitle} onActivate={onOpenCurrencyGap} />
      </>
    ) : (
      commonCopy.gmv
    );
  }
  function renderGmvValue(): ReactElement {
    return currencyRecalculating ? (
      <RecalculatingValue />
    ) : (
      <>
        {formatAmount(gmvValue, gmvCurrency)}
        {gmvProvenanceDefinitions.length > 0 ? (
          <span className="kpi-card__qualifier-rate">
            {gmvInlineRate
              ? formatAppliedRateLine(gmvInlineRate, rateFormat)
              : copy.todaysRates}
            <AnalyticsInfotip
              ariaLabel={copy.aboutConversion}
              definitions={gmvProvenanceDefinitions}
              align="end"
            />
          </span>
        ) : null}
      </>
    );
  }
  const revenuePrimaryLabel = netGrossBasis === 'gross' ? renderGmvLabel() : renderNetSalesLabel();
  const revenuePrimaryValue = netGrossBasis === 'gross' ? renderGmvValue() : renderNetSalesValue();
  const revenueQualifierLabel =
    netGrossBasis === 'gross' ? renderNetSalesLabel() : renderGmvLabel();
  const revenueQualifierValue =
    netGrossBasis === 'gross' ? renderNetSalesValue() : renderGmvValue();

  const trendDays = rangeDays(filters.from, filters.to);

  // Period-over-period deltas — `undefined` previousHeadline (not covered by
  // history, still loading, or failed to load) means every `buildDelta`
  // call below returns `null`, which `AnalyticsKpiCard` renders as a
  // `GapMark` with `deltaGapReason`.
  const previousHeadline = previousCovered ? previousQuery.data?.headline : undefined;
  const previousTrendDays = rangeDays(previousRange.from, previousRange.to);
  const deltaBasisLabel = plural(previousTrendDays, copy.delta.basis);
  const deltaGapReason = !previousCovered
    ? earliestOrderDate === null
      ? copy.delta.noHistory
      : interpolate(copy.delta.notEnoughHistory, { date: earliestOrderDate.slice(0, 10) })
    : previousQuery.error
      ? copy.delta.previousFailed
      : undefined;

  // A RATE MOVES IN POINTS, NOT IN PERCENT (design mockup) — "cancellation
  // rate +10.1%" is ambiguous (ten percent of what?), so a rate delta
  // (`pp: true`) uses `pointsDelta` and renders "pp"; every count/amount
  // delta uses the ordinary relative `percentDelta` and renders "%".
  function buildDelta(
    current: number,
    previous: number | undefined,
    direction: DeltaDirection,
    opts: { pp?: boolean } = {}
  ): AnalyticsKpiDelta | null {
    if (previous === undefined) return null;
    const deltaValue = opts.pp ? pointsDelta(current, previous) : percentDelta(current, previous);
    if (deltaValue === null) return null;
    const direction2 = deltaGlyphDirection(deltaValue);
    const value = deltaFormat.format(Math.abs(deltaValue));
    const spoken = copy.delta.spoken;
    const spokenTemplate =
      direction2 === 'flat'
        ? spoken.flat
        : direction2 === 'up'
          ? opts.pp
            ? spoken.upPoints
            : spoken.upPercent
          : opts.pp
            ? spoken.downPoints
            : spoken.downPercent;
    return {
      formatted: interpolate(opts.pp ? copy.delta.points : copy.delta.percent, { value }),
      tone: deltaTone(deltaValue, direction),
      direction: direction2,
      basisLabel: deltaBasisLabel,
      spokenText: interpolate(spokenTemplate, { value }),
    };
  }

  const previousTotalOrders = previousHeadline
    ? previousHeadline.orderCount + previousHeadline.unconvertedCount
    : undefined;
  const ordersDelta = buildDelta(totalOrders, previousTotalOrders, 'higher-is-better');
  const previousTotalUnitsSold = previousHeadline
    ? previousHeadline.unitsSold + previousHeadline.unconvertedUnitsSold
    : undefined;
  const unitsDelta = buildDelta(totalUnitsSold, previousTotalUnitsSold, 'higher-is-better');
  const previousCancelRate = previousHeadline
    ? cancellationRate(
        previousHeadline.cancelledCount,
        previousHeadline.orderCount + previousHeadline.unconvertedCount
      )
    : undefined;
  const cancelRateDelta = buildDelta(cancelRate, previousCancelRate, 'lower-is-better', {
    pp: true,
  });
  // AOV is currency-denominated — a percentage between two different
  // reporting-currency eras (or a period where nothing is stamped yet)
  // would not be a real number, so this refuses independently of coverage.
  const orderValueCurrenciesMatch =
    headline.currency !== null && headline.currency === previousHeadline?.currency;
  // The basis picks which pair of fields the card reads — see this
  // component's own `netGrossBasis` prop doc comment.
  const averageOrderValue =
    netGrossBasis === 'net' ? headline.netAverageOrderValue : headline.averageOrderValue;
  const medianOrderValue =
    netGrossBasis === 'net' ? headline.netMedianOrderValue : headline.medianOrderValue;
  const previousAverageOrderValue = previousHeadline
    ? netGrossBasis === 'net'
      ? previousHeadline.netAverageOrderValue
      : previousHeadline.averageOrderValue
    : undefined;
  const orderValueDelta = orderValueCurrenciesMatch
    ? buildDelta(averageOrderValue, previousAverageOrderValue, 'higher-is-better')
    : null;
  const orderValueDeltaGapReason =
    !orderValueCurrenciesMatch && previousHeadline
      ? copy.delta.currencyMismatch
      : deltaGapReason;

  return (
    <section className="status-strip status-strip--analytics" aria-label={copy.ariaLabel}>
      <AnalyticsKpiCard
        label={cards.revenue.label}
        infotipLabel={cards.revenue.infotip}
        definitions={[
          {
            term: commonCopy.netSales,
            text: cards.revenue.netSales.text,
            formula: cards.revenue.netSales.formula,
            caveat: netExcludedVisible ? netExcludedNote : copy.gaps.netSalesReturns,
          },
          {
            term: cards.revenue.gmv.term,
            text: cards.revenue.gmv.text,
            caveat: stampedGapVisible
              ? interpolate(cards.revenue.gmv.caveatUnconverted, {
                  unconverted: numberFormat.format(headline.unconvertedCount),
                  total: numberFormat.format(totalOrders),
                })
              : cards.revenue.gmv.caveat,
          },
        ]}
        metric={revenuePrimaryLabel}
        headlineUnavailable={currencyRecalculating}
        value={revenuePrimaryValue}
        trend={{
          values: revenueTrend,
          tone: trendTone(revenueTrend),
          ariaLabel: plural(trendDays, copy.trend.gmv),
        }}
        qualifiers={[
          {
            label: revenueQualifierLabel,
            value: revenueQualifierValue,
          },
        ]}
      />

      <AnalyticsKpiCard
        label={cards.orders.label}
        infotipLabel={cards.orders.infotip}
        definitions={[
          { term: cards.orders.ordersTerm, text: cards.orders.ordersText },
          { term: cards.orders.avgDailyTerm, text: cards.orders.avgDailyText },
        ]}
        metric={cards.orders.metric}
        value={numberFormat.format(totalOrders)}
        trend={{
          values: orderTrend,
          tone: trendTone(orderTrend),
          ariaLabel: plural(trendDays, copy.trend.orders),
        }}
        qualifiers={[{ label: cards.orders.avgDaily, value: ratioFormat.format(avgDaily) }]}
        delta={ordersDelta}
        deltaGapReason={deltaGapReason}
      />

      <AnalyticsKpiCard
        label={cards.orderValue.label}
        infotipLabel={cards.orderValue.infotip}
        definitions={[
          {
            term: cards.orderValue.averageTerm,
            text:
              netGrossBasis === 'net'
                ? cards.orderValue.averageTextNet
                : cards.orderValue.averageTextGross,
            caveat:
              netGrossBasis === 'net'
                ? netExcludedVisible
                  ? netExcludedNote
                  : undefined
                : stampedGapVisible
                  ? copy.gaps.unconverted
                  : undefined,
          },
          {
            term: cards.orderValue.medianTerm,
            text:
              netGrossBasis === 'net'
                ? cards.orderValue.medianTextNet
                : cards.orderValue.medianTextGross,
          },
        ]}
        metric={
          stampedGapVisible ? (
            <>
              {cards.orderValue.metric}{' '}
              <GapMark title={currencyGapTitle} onActivate={onOpenCurrencyGap} />
            </>
          ) : (
            cards.orderValue.metric
          )
        }
        headlineUnavailable={currencyRecalculating}
        value={
          currencyRecalculating ? (
            <RecalculatingValue />
          ) : (
            formatAmount(convertToDisplay(averageOrderValue), currency)
          )
        }
        qualifiers={[
          {
            label: cards.orderValue.median,
            value: currencyRecalculating ? (
              <RecalculatingValue />
            ) : (
              formatAmount(convertToDisplay(medianOrderValue), currency)
            ),
          },
        ]}
        delta={orderValueDelta}
        deltaGapReason={orderValueDeltaGapReason}
      />

      <AnalyticsKpiCard
        label={cards.units.label}
        infotipLabel={cards.units.infotip}
        definitions={[
          { term: cards.units.unitsSoldTerm, text: cards.units.unitsSoldText },
          { term: cards.units.perOrderTerm, text: cards.units.perOrderText },
        ]}
        metric={cards.units.metric}
        value={numberFormat.format(totalUnitsSold)}
        qualifiers={[{ label: cards.units.perOrder, value: ratioFormat.format(unitsRatio) }]}
        delta={unitsDelta}
        deltaGapReason={deltaGapReason}
      />

      <AnalyticsKpiCard
        label={cards.cancellations.label}
        infotipLabel={cards.cancellations.infotip}
        definitions={[
          { term: cards.cancellations.cancelledTerm, text: cards.cancellations.cancelledText },
          { term: cards.cancellations.rateTerm, text: cards.cancellations.rateText },
        ]}
        metric={cards.cancellations.metric}
        value={pctFormat.format(cancelRate)}
        qualifiers={[
          {
            label: cards.cancellations.cancelledOrders,
            value: numberFormat.format(headline.cancelledCount),
          },
          {
            // The one card whose COUNT and VALUE describe different cohorts
            // (#2668 review, SUGGESTION 12). `cancelledCount` is every
            // cancelled order in range; `cancelledValue` covers only the
            // stamped ∧ net-eligible subset, with the remainder reported by
            // `cancelledUnconvertedCount` (no current-era FX stamp) and
            // `cancelledNetExcludedCount` (a line whose tax rate is
            // unresolvable). Both fields have always been on the wire and
            // neither was rendered, so the divergence was invisible and an
            // operator could read a value that omits orders the count beside
            // it includes. It is annotated in place rather than reconciled:
            // the two really do answer different questions.
            label: cancelledValueGapVisible ? (
              <>
                {cards.cancellations.cancelledValue} <GapMark title={cancelledValueGapTitle} />
              </>
            ) : (
              cards.cancellations.cancelledValue
            ),
            value: currencyRecalculating ? (
              <RecalculatingValue />
            ) : (
              formatAmount(convertToDisplay(headline.cancelledValue), currency)
            ),
          },
        ]}
        delta={cancelRateDelta}
        deltaGapReason={deltaGapReason}
      />

      <AnalyticsKpiCard
        label={cards.returns.label}
        infotipLabel={cards.returns.infotip}
        definitions={[
          {
            term: cards.returns.term,
            text: cards.returns.text,
            caveat: copy.gaps.returnRate,
          },
        ]}
        planned
        metric={
          <>
            {cards.returns.metric} <GapMark title={copy.gaps.returnRate} />
          </>
        }
        value={<EmptyValue label={cards.returns.empty} />}
      />
    </section>
  );
}
