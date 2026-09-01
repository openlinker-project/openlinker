/**
 * Display-currency view helpers (#2472, ADR-064)
 *
 * Pure derivations shared by `AnalyticsCurrencyPicker` and
 * `AnalyticsConvertNote` — kept out of the components so the "what state am
 * I in" rule can be unit-tested without rendering anything.
 *
 * @module features/analytics/lib
 */
import type {
  AppliedRate,
  DisplayCurrencyRateBasis,
  SalesAndChannelAnalytics,
} from '../api/sales-analytics.types';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';
import type { AnalyticsInfotipDefinition } from '../components/analytics-infotip';

/**
 * A small curated list an operator can pick from in the toolbar. Must stay a
 * subset of the backend's `SUPPORTED_REPORTING_CURRENCIES` (currently
 * `PLN`/`EUR`, see `libs/core/src/currency/domain/types/reporting-currency.
 * types.ts`) — `displayCurrency` is validated against that exact list with
 * `@IsIn` + `forbidNonWhitelisted: true`, so offering a currency the backend
 * doesn't recognize (USD/GBP previously) makes every request answer 400 and
 * the whole KPI strip render as a load failure. `EUR` was previously mirrored
 * from the reference mockup's picker options without checking backend
 * support.
 */
export const DISPLAY_CURRENCY_OPTIONS = ['PLN', 'EUR'] as const;

export const ConvertNoteStateValues = ['native', 'converting', 'converted', 'unavailable'] as const;
export type ConvertNoteState = (typeof ConvertNoteStateValues)[number];

interface ConvertNoteStateInput {
  /** `null`/`''` means no override is selected — the reporting currency itself is shown. */
  displayCurrency: string | null;
  isLoading: boolean;
  isError: boolean;
  data: SalesAndChannelAnalytics | undefined;
}

/**
 * Derives the convert-note state from the sales query the KPI strip already
 * shares a cache entry with (`salesAnalyticsQueryKeys.sales`) — no second
 * request. `'unavailable'` covers both a request failure and a successful
 * response whose `displayCurrencyConversion.convertedRevenue` is `null`
 * (ADR-064: a native currency with no resolvable rate degrades to an
 * explicit unavailable state, never a silent guess).
 */
export function resolveConvertNoteState(input: ConvertNoteStateInput): ConvertNoteState {
  if (!input.displayCurrency) {
    return 'native';
  }
  if (input.isError) {
    return 'unavailable';
  }
  if (input.isLoading) {
    return 'converting';
  }
  const conversion = input.data?.headline.displayCurrencyConversion;
  if (conversion && conversion.convertedRevenue !== null) {
    return 'converted';
  }
  return 'unavailable';
}

/**
 * REJECTED APPROACH, NARROWED BY #2778/#2779 — recorded so the SPECIFIC
 * mistake below isn't repeated, now that a sound alternative exists for the
 * general problem it was trying to solve.
 *
 * An earlier revision of this file derived a "live rate" as
 * `convertedRevenue / revenue` and applied it client-side to every other
 * same-currency figure (netRevenue, AOV, median, cancelled value). That is
 * UNSOUND and was caught by a real bad number in production (29 000 PLN
 * rendering as ~20 000 "EUR" instead of the correct ~6 700 EUR). The reason:
 * in "current rate" mode, `convertedRevenue` is NOT `revenue` converted — it
 * is `revenue` (the stamped bucket) PLUS `unconvertedValue` (a separate pool
 * of not-yet-stamped/prior-era money), both converted and SUMMED (see
 * `SalesAnalyticsController.buildNativeCurrencyAmounts`). So DIVIDING
 * `convertedRevenue` by `revenue` to back out "the rate" is contaminated by
 * however much unconverted money exists and is not the actual exchange rate.
 *
 * #2778 closes this the right way: the backend now reports the REAL,
 * published rate it applied to EACH native-currency bucket individually
 * (`NativeCurrencyBreakdown.appliedRate` / `OrderDateConversionResult.
 * appliedRate`), never a value this file has to reconstruct by arithmetic on
 * two unrelated totals. `resolveReportingCurrencyRate` picks the ONE entry
 * whose `from` matches `headline.currency` — the SAME bucket `revenue`
 * itself came from — so multiplying `netRevenue`/AOV/median/cancelledValue
 * (all denominated in that exact bucket's currency, per ADR-040's one
 * system-wide reporting currency invariant) by that rate is not a derived
 * approximation: it is the literal rate the backend already applied to that
 * bucket, reused for a second figure expressed in the same currency. The
 * failure mode above was dividing two DIFFERENT things pretending the result
 * was a rate; this multiplies the SAME rate against a second same-currency
 * amount, which is ordinary arithmetic, not a shortcut.
 *
 * What remains true and unchanged: a figure with NO resolvable rate for
 * `headline.currency` (unresolved conversion, or an identity where nothing
 * was looked up) still renders in the native reporting currency, never a
 * guessed number — `resolveReportingCurrencyRate` returns `null` in exactly
 * those cases and every call site must treat that as "stay native", the same
 * discipline the old rule enforced, just no longer by refusing conversion
 * altogether.
 */
export function resolveReportingCurrencyRate(
  conversion: { rateBasis: DisplayCurrencyRateBasis; appliedRates: readonly AppliedRate[] } | undefined,
  nativeCurrency: string | null
): AppliedRate | null {
  if (!conversion || nativeCurrency === null) {
    return null;
  }
  if (conversion.rateBasis === 'order-date') {
    // Already exactly the rate for `reportingCurrency -> displayCurrency` —
    // `OrderDateConversionResult` never carries more than one.
    return conversion.appliedRates[0] ?? null;
  }
  // `current-rate` mode: find the ONE breakdown row for this exact native
  // currency — never the first entry, which could belong to the separate
  // unconverted-money bucket if that bucket's currency differs.
  return conversion.appliedRates.find((rate) => rate.from === nativeCurrency) ?? null;
}

/**
 * `true` while a currency remediation run (operator-triggered "Recalculate
 * now", or a currency-setting change's own follow-up) is actively rewriting
 * the `currency` Data Coverage category. Shared by `AnalyticsKpiStrip`,
 * `ChannelSalesTable`, `ProductSalesTable`, and `AnalyticsConvertNote` — all
 * four previously derived this predicate independently (tech-review
 * finding, PR #2781), which is exactly the kind of copy that drifts the
 * next time one call site's wording changes but the others don't.
 * `coverage` is `undefined` while the Data Coverage read hasn't resolved
 * yet, which correctly reads as "not recalculating" rather than blocking
 * the rest of the page on a second fetch.
 */
export function isCurrencyRecalculating(coverage: AnalyticsCoverage | undefined): boolean {
  return (
    coverage?.categories.some((row) => row.category === 'currency' && row.status === 'in-progress') ??
    false
  );
}

/**
 * Rate provenance for the GMV qualifier (#2778/#2779).
 *
 * `appliedRates` is 0..N because `current-rate` mode can genuinely span
 * several native currencies (the stamped `revenue` bucket plus the separate
 * `unconvertedValue` bucket, each independently converted — see the
 * "REJECTED APPROACH" note above for why nothing here may be derived by
 * dividing two totals). A single inline line can only ever honestly name
 * ONE rate, so:
 *
 * - exactly one entry → that IS the rate behind the figure, safe to show
 *   inline.
 * - zero entries → nothing converted (the whole set is unresolved) or an
 *   identity (native currency already equalled the display currency) — no
 *   rate line, ever.
 * - two or more entries → several different rates fed one number; naming
 *   just one inline would misrepresent it as the whole story, so the inline
 *   line stays silent and the full breakdown lives only in the disclosure.
 */
export function pickInlineAppliedRate(appliedRates: readonly AppliedRate[]): AppliedRate | null {
  return appliedRates.length === 1 ? appliedRates[0] : null;
}

/**
 * "1 EUR = 4.25 PLN (NBP, 2026-08-29)" — every value taken verbatim from the
 * response: no currency name, source label or date format is invented here.
 * `rate` is `Number()`'d ONLY for display rounding, never for arithmetic —
 * the string itself remains the audited value (`rate.rate`).
 */
export function formatAppliedRateLine(rate: AppliedRate): string {
  const formattedRate = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(rate.rate));
  return `1 ${rate.from} = ${formattedRate} ${rate.to} (${rate.source.toUpperCase()}, ${rate.rateDate})`;
}

/**
 * The disclosure content behind the (i) trigger next to a converted GMV
 * figure (#2778/#2779) — reuses `AnalyticsInfotip` verbatim rather than a
 * new component, per the issue's own "reuse over invention" instruction.
 *
 * Empty `appliedRates` (nothing converted) returns `[]`, since there is
 * nothing to disclose — the caller must not even render the trigger then,
 * or an operator would open an empty popover.
 */
export function buildRateProvenanceDefinitions(
  rateBasis: DisplayCurrencyRateBasis,
  appliedRates: readonly AppliedRate[]
): AnalyticsInfotipDefinition[] {
  if (appliedRates.length === 0) {
    return [];
  }

  const modeDefinition: AnalyticsInfotipDefinition =
    rateBasis === 'order-date'
      ? {
          term: 'Rate on order date',
          text: "One current rate applied to the whole period's total — not each order's own historical rate.",
        }
      : {
          term: 'Current rate',
          text: "Today's rate applied to each order's own native currency, then summed.",
        };

  const rateDefinitions: AnalyticsInfotipDefinition[] = appliedRates.map((rate) => ({
    term: `${rate.from} → ${rate.to}`,
    text: formatAppliedRateLine(rate),
    caveat:
      rate.derivation !== 'direct'
        ? `Derived (${rate.derivation})${rate.sourceRef ? ` — ${rate.sourceRef}` : ''}`
        : (rate.sourceRef ?? undefined),
  }));

  const disclaimerDefinition: AnalyticsInfotipDefinition = {
    term: 'Not an invoice rate',
    text: 'This is an analytics-only conversion for viewing the dashboard — never the statutory rate used on an invoice.',
  };

  return [modeDefinition, ...rateDefinitions, disclaimerDefinition];
}
