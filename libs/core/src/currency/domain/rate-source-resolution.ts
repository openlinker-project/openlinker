/**
 * Rate Source Resolution
 *
 * Which publisher serves a given reporting currency. A pure, total function
 * over `SUPPORTED_REPORTING_CURRENCIES` - no I/O, no configuration.
 *
 * @module libs/core/src/currency/domain
 */
import { ReportingCurrencyUnsupportedError } from './exceptions/reporting-currency.exception';
import type { ExchangeRateSource } from './types/exchange-rate.types';
import {
  SUPPORTED_REPORTING_CURRENCIES,
  type SupportedReportingCurrency,
} from './types/reporting-currency.types';

/**
 * A code constant, NOT a second setting, and that is the point: each provider
 * quotes against exactly one base (NBP publishes `X -> PLN`, ECB publishes
 * `EUR -> X`), so pairing the source with the reporting currency is what keeps
 * every pair a direct published quote or a single documented inversion. Left
 * as an operator choice, a PLN-reporting deployment reading ECB would pivot
 * every single order through EUR for no benefit.
 */
const SOURCE_BY_REPORTING_CURRENCY: Readonly<
  Record<SupportedReportingCurrency, ExchangeRateSource>
> = {
  PLN: 'nbp',
  EUR: 'ecb',
};

/**
 * The publisher to read for a deployment reporting in `reportingCurrency`.
 *
 * @throws ReportingCurrencyUnsupportedError when the currency has no publisher
 */
export function resolveRateSource(reportingCurrency: string): ExchangeRateSource {
  const source = (
    SOURCE_BY_REPORTING_CURRENCY as Readonly<Record<string, ExchangeRateSource | undefined>>
  )[reportingCurrency];

  if (source === undefined) {
    throw new ReportingCurrencyUnsupportedError(reportingCurrency, SUPPORTED_REPORTING_CURRENCIES);
  }

  return source;
}
