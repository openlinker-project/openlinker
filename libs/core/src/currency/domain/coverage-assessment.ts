/**
 * Reporting Currency Coverage Assessment
 *
 * Layer 3 of save-time validation: given the native currencies a deployment
 * has actually seen, report which of them the candidate reporting currency's
 * provider cannot convert from.
 *
 * Pure and side-effect-free - it touches only the provider's own `supports`
 * predicate, which is itself a static array test. Zero HTTP, so the settings
 * save path never blocks on a provider being reachable.
 *
 * It WARNS AND NEVER BLOCKS. Blocking on history would let one junk currency
 * in an old order snapshot make an otherwise legitimate reporting currency
 * permanently unsettable.
 *
 * The composition - feeding it the observed set, which lives in `orders` -
 * happens in the interfaces layer, where composing two contexts is legal. Doing
 * it here would create a `currency -> orders` edge and cost this context its
 * leaf property.
 *
 * @module libs/core/src/currency/domain
 */
import type { ExchangeRateProviderPort } from './ports/exchange-rate-provider.port';
import type { ReportingCurrencyCoverage } from './types/reporting-currency.types';

/**
 * @param reportingCurrency the currency being considered
 * @param observedCurrencies native currencies seen on existing orders
 * @param provider the publisher that would serve `reportingCurrency`
 */
export function assessCoverage(
  reportingCurrency: string,
  observedCurrencies: readonly string[],
  provider: ExchangeRateProviderPort
): ReportingCurrencyCoverage {
  const observed = Array.from(new Set(observedCurrencies));

  return {
    reportingCurrency,
    observedCurrencies: observed,
    // An order already in the reporting currency needs no rate at all (the
    // stamp short-circuits), so it can never be uncoverable - excluded here
    // rather than relying on every provider's `supports` to agree about a
    // same-currency pair.
    uncoverableCurrencies: observed.filter(
      (currency) => currency !== reportingCurrency && !provider.supports(currency, reportingCurrency)
    ),
  };
}
