/**
 * Currency Rate Service Interface
 *
 * The get-or-create read over the shared `exchange_rates` registry.
 *
 * @module libs/core/src/currency/application/interfaces
 */
import type { GetRateInput, StoredExchangeRate } from '../../domain/types/exchange-rate.types';

export interface ICurrencyRateService {
  /**
   * Return the registry row for `(source, from, to, rateDate)`, fetching it
   * from the provider only if it is not already registered.
   *
   * `rateDate` and `source` arrive ALREADY RESOLVED - `resolveRateDate` and
   * `resolveRateSource` run in the caller, because the caller owns `placedAt`
   * and the resolved reporting currency. That is what keeps `currency` a leaf
   * context with no back-edge to `orders`.
   *
   * @throws RateUnsupportedPairError terminal
   * @throws RateUnavailableTransientError retryable
   * @throws UnregisteredExchangeRateSourceError terminal
   */
  getRateFor(input: GetRateInput): Promise<StoredExchangeRate>;
}
