/**
 * Display-currency view helpers (#2472, ADR-064)
 *
 * Pure derivations shared by `AnalyticsCurrencyPicker` and
 * `AnalyticsConvertNote` — kept out of the components so the "what state am
 * I in" rule can be unit-tested without rendering anything.
 *
 * @module features/analytics/lib
 */
import type { SalesAndChannelAnalytics } from '../api/sales-analytics.types';

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
 * REJECTED APPROACH — recorded so it isn't tried again. An earlier revision
 * of this file derived a "live rate" as `convertedRevenue / revenue` and
 * applied it client-side to every other same-currency figure (netRevenue,
 * AOV, median, cancelled value, Top Products). That is UNSOUND and was
 * caught by a real bad number in production (29 000 PLN rendering as
 * ~20 000 "EUR" instead of the correct ~6 700 EUR).
 *
 * The reason: in "current rate" mode, `convertedRevenue` is NOT `revenue`
 * converted — it is `revenue` (the stamped bucket) PLUS `unconvertedValue`
 * (a separate pool of not-yet-stamped/prior-era money), both converted and
 * SUMMED (see `SalesAnalyticsController.buildNativeCurrencyAmounts`, which
 * feeds both buckets into `convertAtCurrentRate`). That is the deliberate,
 * correct design for the GMV headline figure itself (it reports the FULL
 * picture — stamped and unconverted — worth today), but it means
 * `convertedRevenue / revenue` is contaminated by however much unconverted
 * money exists and is NOT the actual exchange rate. Applying it to any other
 * figure silently produces a wrong number — worse than not converting at
 * all, because a wrong number looks trustworthy.
 *
 * The only figure this file — and every consumer of `SalesAnalyticsHeadline.
 * displayCurrencyConversion` — may render in the display currency is
 * `convertedRevenue` itself, verbatim, exactly as the backend returns it.
 * Every other money figure (netRevenue, AOV, median, cancelledValue, the
 * channel table, Top Products) MUST stay in the native reporting currency
 * until the backend is extended to compute a real converted value for each
 * of them — there is no safe client-side shortcut.
 */
