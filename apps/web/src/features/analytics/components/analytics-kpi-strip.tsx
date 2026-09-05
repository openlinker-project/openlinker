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
 *     (`headline.netRevenue`) — per the reference design mockup this renders
 *     as a normal, complete "Net sales" headline (no gap badge on the card
 *     face); the still-open returns caveat and the tax-rate exclusion count
 *     (`headline.netExcludedCount` — pre-rollout orders, or an order with an
 *     unresolvable line-level tax rate) live only in the (i) tooltip's
 *     definition, never as a second qualifier row. Its GMV qualifier
 *     (`headline.revenue`, real, FX-stamped, in `headline.currency`) renders
 *     normally, unchanged.
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
 *     known amount in the reporting currency, and that is the SAME
 *     restriction `revenue`/`orderCount` (Number of Orders) already apply,
 *     disclosed via the same `STAMPED_GAP` gap mark as before. Under
 *     `netGrossBasis="net"` — an operator's own explicit choice to view the
 *     page net-of-VAT — the card instead reads `netAverageOrderValue`/
 *     `netMedianOrderValue`, whose narrower net-eligible cohort is disclosed
 *     via `netExcludedNote` instead. The Revenue card is deliberately NOT
 *     gated on this prop: it already shows Net Sales (primary) and GMV
 *     (qualifier) unconditionally, both bases visible at once, so there is
 *     nothing for a basis toggle to add there.
 *   - Returns & refunds: no return/refund entity exists anywhere in the
 *     orders domain — fully planned.
 *   - Cancellations: `cancelledCount`/`cancelledValue` are real fields —
 *     rendered as a normal, real card.
 *   - Delta ("vs previous period"), on the four cards with a real headline
 *     number (Orders, Order value, Units, Cancellations): a second
 *     `GET /analytics/sales` call over the immediately-preceding period of
 *     the same length (`computePreviousPeriodRange`), refused outright
 *     (never a lopsided comparison) unless that ENTIRE previous window is
 *     covered by ingested order history (`isPreviousPeriodCovered`, keyed
 *     off `GET /analytics/trust`'s per-connection `earliestOrderDate`,
 *     #2083) — see the per-card `deltaFor*` helpers below. Revenue's
 *     headline and Returns & refunds are both already `unavailable`/
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
import { deriveCoverageRowCopy } from '../lib/data-coverage-copy.lib';
import type {
  AnalyticsCoverage,
  CoverageCategory,
  CoverageCategoryRow,
} from '../api/analytics-coverage.types';

// The metrics spec defines Net Sales as NOV minus the value of returns
// (docs/specs/metrics-analytics-dashboard.md § Net Sales) — quoted, not
// paraphrased, per .claude/rules/analytics-metrics.md. NOV itself is now
// real (net-sales tax-rate epic); this is the ONE remaining, distinct gap.
const NET_SALES_RETURNS_GAP =
  'Net Sales additionally subtracts the value of returns, and no return or refund entity exists anywhere in the repo yet — this figure is NOV (net order value), not yet Net Sales.';
const RETURN_RATE_GAP =
  'No return entity exists anywhere in the repo — nothing records a return or a refund.';
const STAMPED_GAP =
  'Order value is computed only from orders an FX rate has been stamped onto — recently ingested, not-yet-stamped orders are excluded from this figure until the FX stamp sweep reaches them.';
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
        eyebrow="Loading"
        title="Loading sales figures"
        message="Fetching revenue, orders and units for the selected range…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load sales figures"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const headline = query.data?.headline;
  if (!headline) {
    return (
      <ErrorState
        title="Unable to load sales figures"
        message="The server returned no data for this range."
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
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
  const netExcludedNote = `${headline.netExcludedCount} order(s) predate per-line tax rates or carry a line with an unresolvable rate, and are excluded from NOV.`;

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
      : STAMPED_GAP;
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
  const trendDays = rangeDays(filters.from, filters.to);
  const trendRangeLabel = trendDays === 1 ? 'the selected day' : `the last ${trendDays} days`;

  // Period-over-period deltas — `undefined` previousHeadline (not covered by
  // history, still loading, or failed to load) means every `buildDelta`
  // call below returns `null`, which `AnalyticsKpiCard` renders as a
  // `GapMark` with `deltaGapReason`.
  const previousHeadline = previousCovered ? previousQuery.data?.headline : undefined;
  const previousTrendDays = rangeDays(previousRange.from, previousRange.to);
  const deltaBasisLabel =
    previousTrendDays === 1 ? 'vs the previous day' : `vs previous ${previousTrendDays} days`;
  const deltaGapReason = !previousCovered
    ? earliestOrderDate === null
      ? 'No order history yet — nothing to compare against.'
      : `Not enough order history to compare a full previous period — data starts ${earliestOrderDate.slice(0, 10)}.`
    : previousQuery.error
      ? 'Unable to load the previous period for comparison.'
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
    const unit = opts.pp ? 'pp' : '%';
    const spokenAmount = `${deltaFormat.format(Math.abs(deltaValue))} ${opts.pp ? 'percentage points' : 'percent'}`;
    return {
      formatted: `${deltaFormat.format(Math.abs(deltaValue))}${opts.pp ? ' ' : ''}${unit}`,
      tone: deltaTone(deltaValue, direction),
      direction: direction2,
      basisLabel: deltaBasisLabel,
      spokenText: `${direction2 === 'flat' ? 'unchanged' : `${direction2 === 'up' ? 'up' : 'down'} ${spokenAmount}`} versus the previous period`,
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
      ? 'The two periods are not stamped in the same reporting currency — a percentage between them would not be a real number.'
      : deltaGapReason;

  return (
    <section className="status-strip status-strip--analytics" aria-label="Key sales figures">
      <AnalyticsKpiCard
        label="Revenue"
        infotipLabel="About the Revenue figures"
        definitions={[
          {
            term: 'Net Sales',
            text: 'The value of product sales after discounts and after customer refunds, excluding VAT. Rendered here as NOV (net order value, before the returns subtraction) — the exact figure is what the metrics spec calls Net Sales once returns are also modeled.',
            formula: 'Net order value (after discounts, excluding VAT) − Refunded value',
            caveat: netExcludedVisible ? netExcludedNote : NET_SALES_RETURNS_GAP,
          },
          {
            term: 'GMV (Gross Merchandise Value)',
            text: 'The value of non-cancelled, FX-stamped product items in orders placed during the selected period, in the reporting currency.',
            caveat: stampedGapVisible
              ? `Cancelled orders and cancelled items are excluded. ${headline.unconvertedCount} of ${totalOrders} placed orders have not yet been FX-stamped and are omitted from this figure.`
              : 'Cancelled orders and cancelled items are excluded. Returned/refunded items remain included.',
          },
        ]}
        metric={
          netExcludedGapOpen ? (
            <>
              Net sales{' '}
              <GapMark
                title={netExcludedGapTitle ?? netExcludedNote}
                onActivate={onOpenNetExcludedGap}
              />
            </>
          ) : (
            'Net sales'
          )
        }
        headlineUnavailable={currencyRecalculating}
        value={
          currencyRecalculating ? (
            <RecalculatingValue />
          ) : (
            formatAmount(convertToDisplay(headline.netRevenue), currency)
          )
        }
        trend={{
          values: revenueTrend,
          tone: trendTone(revenueTrend),
          ariaLabel: `GMV trend, ${trendRangeLabel}`,
        }}
        qualifiers={[
          {
            label: stampedGapVisible ? (
              <>
                GMV <GapMark title={currencyGapTitle} onActivate={onOpenCurrencyGap} />
              </>
            ) : (
              'GMV'
            ),
            value: currencyRecalculating ? (
              <RecalculatingValue />
            ) : (
              <>
                {formatAmount(gmvValue, gmvCurrency)}
                {gmvProvenanceDefinitions.length > 0 ? (
                  <span className="kpi-card__qualifier-rate">
                    {gmvInlineRate
                      ? formatAppliedRateLine(gmvInlineRate, rateFormat)
                      : "today's rate(s)"}
                    <AnalyticsInfotip
                      ariaLabel="About this conversion"
                      definitions={gmvProvenanceDefinitions}
                      align="end"
                    />
                  </span>
                ) : null}
              </>
            ),
          },
        ]}
      />

      <AnalyticsKpiCard
        label="Orders"
        infotipLabel="About the Orders figures"
        definitions={[
          {
            term: 'Orders',
            text: 'Every non-cancelled order placed during the selected period, across every connected channel.',
          },
          {
            term: 'Avg. daily orders',
            text: 'Orders divided by the number of days in the selected range.',
          },
        ]}
        metric="Placed orders"
        value={numberFormat.format(totalOrders)}
        trend={{
          values: orderTrend,
          tone: trendTone(orderTrend),
          ariaLabel: `Order count trend, ${trendRangeLabel}`,
        }}
        qualifiers={[{ label: 'Avg. daily', value: ratioFormat.format(avgDaily) }]}
        delta={ordersDelta}
        deltaGapReason={deltaGapReason}
      />

      <AnalyticsKpiCard
        label="Order value"
        infotipLabel="About the Order value figures"
        definitions={[
          {
            term: 'Average order value (AOV)',
            text:
              netGrossBasis === 'net'
                ? 'The VAT-exclusive value of every net-sales-eligible order placed in the period, divided by the number of such orders — a narrower cohort than Number of Orders (see the caveat below).'
                : 'The gross value of every FX-stamped order placed in the period, divided by the number of FX-stamped orders it was computed from — the same order set as Number of Orders, minus the not-yet-stamped ones.',
            caveat:
              netGrossBasis === 'net'
                ? netExcludedVisible
                  ? netExcludedNote
                  : undefined
                : stampedGapVisible
                  ? STAMPED_GAP
                  : undefined,
          },
          {
            term: 'Median order value',
            text:
              netGrossBasis === 'net'
                ? 'The middle VAT-exclusive value of every net-sales-eligible order in the range — less skewed by a handful of very large or very small orders than the average.'
                : 'The middle gross value of every FX-stamped order in the range — less skewed by a handful of very large or very small orders than the average.',
          },
        ]}
        metric={
          stampedGapVisible ? (
            <>
              Average <GapMark title={currencyGapTitle} onActivate={onOpenCurrencyGap} />
            </>
          ) : (
            'Average'
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
            label: 'Median',
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
        label="Units"
        infotipLabel="About the Units figures"
        definitions={[
          {
            term: 'Units sold',
            text: 'Total item quantity across every non-cancelled order line in the selected period.',
          },
          { term: 'Units per order', text: 'Units sold divided by placed orders.' },
        ]}
        metric="Units sold"
        value={numberFormat.format(totalUnitsSold)}
        qualifiers={[{ label: 'Per order', value: ratioFormat.format(unitsRatio) }]}
        delta={unitsDelta}
        deltaGapReason={deltaGapReason}
      />

      <AnalyticsKpiCard
        label="Cancellations"
        infotipLabel="About the Cancellations figures"
        definitions={[
          {
            term: 'Cancelled orders',
            text: 'Orders placed in the selected period that were subsequently cancelled — excluded from every revenue figure on this page.',
          },
          {
            term: 'Cancellation rate',
            text: 'Cancelled orders divided by all orders placed in the period, including the cancelled ones themselves.',
          },
        ]}
        metric="Cancellation rate"
        value={pctFormat.format(cancelRate)}
        qualifiers={[
          { label: 'Cancelled orders', value: numberFormat.format(headline.cancelledCount) },
          {
            label: 'Cancelled value',
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
        label="Returns & refunds"
        infotipLabel="About Returns & refunds"
        definitions={[
          {
            term: 'Returns & refunds',
            text: 'No return or refund entity exists anywhere in the orders domain yet — this card has nothing to report.',
            caveat: RETURN_RATE_GAP,
          },
        ]}
        planned
        metric={
          <>
            Return rate <GapMark title={RETURN_RATE_GAP} />
          </>
        }
        value={<EmptyValue label="No return/refund entity exists yet" />}
      />
    </section>
  );
}
