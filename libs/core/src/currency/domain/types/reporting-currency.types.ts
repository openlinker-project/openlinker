/**
 * Reporting Currency Types
 *
 * The system-level currency every order total is additionally stamped in, the
 * provenance of the resolved value, and the coverage advisory returned on save.
 *
 * `ReportingCurrencySource` here is the PROVENANCE of the setting (which rung
 * of `row -> env -> default` answered), NOT to be confused with
 * `ExchangeRateSource` in `exchange-rate.types.ts`, which is which PUBLISHER a
 * rate came from. Two `*Source` types in one context is a review trap, so they
 * are named apart on purpose.
 *
 * @module libs/core/src/currency/domain/types
 */

/**
 * Currencies OpenLinker will report in today.
 *
 * Deliberately narrower than "every currency a provider quotes": each entry
 * needs a publisher that quotes it as a base (see `SOURCE_BY_REPORTING_CURRENCY`
 * in `rate-source-resolution.ts`), which is what keeps every pair direct or a
 * single documented inversion.
 */
export const SUPPORTED_REPORTING_CURRENCIES = ['PLN', 'EUR'] as const;

export type SupportedReportingCurrency = (typeof SUPPORTED_REPORTING_CURRENCIES)[number];

/**
 * The value used when neither a settings row nor `OL_REPORTING_CURRENCY`
 * supplies one. The default CONVERTS, so it must announce itself - which is
 * what `ReportingCurrencySettingsView.source` exists for.
 */
export const DEFAULT_REPORTING_CURRENCY: SupportedReportingCurrency = 'EUR';

/** The env var consulted between the settings row and the default. */
export const REPORTING_CURRENCY_ENV_VAR = 'OL_REPORTING_CURRENCY';

/** Which rung of `row -> env -> default` produced the resolved value. */
export const REPORTING_CURRENCY_SOURCES = ['setting', 'env', 'default'] as const;

export type ReportingCurrencySource = (typeof REPORTING_CURRENCY_SOURCES)[number];

/** Runtime narrowing for a value read back out of the database or an env var. */
export function isSupportedReportingCurrency(value: string): value is SupportedReportingCurrency {
  return (SUPPORTED_REPORTING_CURRENCIES as readonly string[]).includes(value);
}

/**
 * What the settings read surface returns.
 *
 * `source !== 'setting'` is the discriminator the frontend renders as
 * `EUR (default)` - mirroring `MultiProviderSettingsView.activeUpdatedAt === null`
 * rather than comparing against a hardcoded `'EUR'` on the client.
 */
export interface ReportingCurrencySettingsView {
  readonly reportingCurrency: string;
  readonly source: ReportingCurrencySource;
  /** `null` on the env / default rungs - there is no row to have been written. */
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
  /**
   * The currencies a `PUT` would accept right now: the supported set narrowed
   * to what the registered providers can actually reach.
   */
  readonly supportedCurrencies: readonly string[];
}

/**
 * The save-time coverage advisory (layer 3 of validation).
 *
 * WARNS, NEVER BLOCKS: blocking on history would let one junk currency in an
 * old snapshot make a legitimate reporting currency permanently unsettable.
 */
export interface ReportingCurrencyCoverage {
  readonly reportingCurrency: string;
  /** The native currencies observed on existing orders. */
  readonly observedCurrencies: readonly string[];
  /** The subset the selected currency's provider cannot convert from. */
  readonly uncoverableCurrencies: readonly string[];
}

/** Options accepted by `setReportingCurrency`. */
export interface SetReportingCurrencyOptions {
  /**
   * The operator has seen a `ReportingCurrencyCoverage` with a non-empty
   * `uncoverableCurrencies` and chose to proceed. Recorded on the audit log
   * line; it never gates the write, because layer 3 never blocks.
   */
  readonly acknowledgeCoverageGaps?: boolean;
}
