/**
 * Exchange Rate Lookup Service Interface
 *
 * The read-only seam over the `exchange_rates` registry (#2778) — deliberately
 * separate from {@link ICurrencyRateService}, whose `getRateFor` is a
 * get-or-create with a real provider side effect. This interface exposes only
 * a pure registry READ, which is what makes it safe to reach from an HTTP
 * controller: an operator hitting `GET /currency/rates` can never spend the
 * deployment's provider budget or mint a new registry row.
 *
 * @module libs/core/src/currency/application/interfaces
 */
import type { ExchangeRateKey, StoredExchangeRate } from '../../domain/types/exchange-rate.types';

export interface IExchangeRateLookupService {
  /**
   * The registry row for `key`, or `null` when nothing is stored under it.
   * Never calls a provider and never writes — a direct passthrough to
   * `ExchangeRateRepositoryPort.findByKey`.
   */
  findRate(key: ExchangeRateKey): Promise<StoredExchangeRate | null>;
}
