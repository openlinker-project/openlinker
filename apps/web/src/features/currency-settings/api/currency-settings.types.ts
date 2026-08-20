/**
 * Currency Settings — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/currency/http/dto/*.ts`. Kept FE-local so the web bundle
 * stays independent of NestJS / core imports.
 *
 * @module apps/web/src/features/currency-settings/api
 */

export const ReportingCurrencySourceValues = ['setting', 'env', 'default'] as const;
export type ReportingCurrencySource = (typeof ReportingCurrencySourceValues)[number];

/** How much of an existing catalogue currency a candidate reporting currency cannot convert. */
export interface ReportingCurrencyCoverage {
  reportingCurrency: string;
  /** The publisher that would serve this candidate, or `null` when none is registered. */
  rateSource: string | null;
  /** Order-native currencies this deployment has already ingested. */
  observedCurrencies: string[];
  /** The observed currencies this candidate cannot convert from. Advisory only — never blocks. */
  uncoverableCurrencies: string[];
}

/** Already-stamped rows for one reporting currency — one entry per era. */
export interface StampedOrderCount {
  reportingCurrency: string;
  count: number;
}

/** Response shape for `GET /currency-settings`. */
export interface CurrencySettingsView {
  reportingCurrency: string;
  source: ReportingCurrencySource;
  updatedAt: string | null;
  updatedBy: string | null;
  supportedCurrencies: string[];
  rateSource: string | null;
  rateDateRule: string;
  stampedOrders: StampedOrderCount[];
  coverage: ReportingCurrencyCoverage[];
}

/** Body for `PUT /currency-settings/reporting-currency`. */
export interface SetReportingCurrencyInput {
  reportingCurrency: string;
  acknowledgeCoverageGaps?: boolean;
}
