/**
 * Exchange Rate Provider Registry Port
 *
 * The seam that lets `@openlinker/integrations-fx` hand its adapters to core
 * without core ever importing them - the same shape integration modules
 * already use to populate `AdapterRegistryService` (#570/#571). It is why
 * `CurrencyModule` must stay a STATIC `@Module`: core and the fx package have
 * to resolve one shared registry instance.
 *
 * @module libs/core/src/currency/domain/ports
 */
import type { ExchangeRateSource } from '../types/exchange-rate.types';
import type { ExchangeRateProviderPort } from './exchange-rate-provider.port';

export interface ExchangeRateProviderRegistryPort {
  /**
   * @throws DuplicateExchangeRateSourceError when the source is already claimed
   */
  register(provider: ExchangeRateProviderPort): void;

  /**
   * @throws UnregisteredExchangeRateSourceError terminal - a wiring fault no
   *         retry can fix
   */
  get(source: ExchangeRateSource): ExchangeRateProviderPort;

  has(source: ExchangeRateSource): boolean;

  /**
   * Every registered provider. Consumed by save-time reporting-currency
   * validation to compute the reachable currency set.
   */
  list(): readonly ExchangeRateProviderPort[];
}
