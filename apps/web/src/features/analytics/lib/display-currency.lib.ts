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
 * A small curated list an operator can pick from in the toolbar. Not a
 * fetched "every ISO-4217 currency the backend's rate providers can quote"
 * list (`SUPPORTED_REPORTING_CURRENCIES` stays a backend-only concept) —
 * this mirrors the reference mockup's own picker options.
 */
export const DISPLAY_CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP'] as const;

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
