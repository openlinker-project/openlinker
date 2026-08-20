/**
 * Currency Module Boot-Assertion Tests
 *
 * The module carries exactly one behaviour worth testing: it refuses to finish
 * boot with an empty exchange-rate provider registry (#2135 review, finding 9).
 *
 * Constructed directly rather than through a Nest container - the hook is a plain
 * method and the container would only add a DI graph that says nothing about the
 * assertion.
 *
 * @module libs/core/src/currency/__tests__
 */
import { CurrencyModule } from '../currency.module';
import { NoExchangeRateProvidersRegisteredError } from '../domain/exceptions/exchange-rate-source.exception';
import type { ExchangeRateProviderPort } from '../domain/ports/exchange-rate-provider.port';
import type { ExchangeRateProviderRegistryPort } from '../domain/ports/exchange-rate-provider-registry.port';

function registryWith(
  providers: readonly ExchangeRateProviderPort[]
): ExchangeRateProviderRegistryPort {
  return {
    register: jest.fn(),
    get: jest.fn(),
    has: jest.fn().mockReturnValue(providers.length > 0),
    list: jest.fn().mockReturnValue(providers),
  };
}

function fakeProvider(name: string): ExchangeRateProviderPort {
  return {
    name: name as ExchangeRateProviderPort['name'],
    pivotCurrency: null,
    supports: jest.fn().mockReturnValue(true),
    listSupportedCurrencies: jest.fn().mockReturnValue([]),
    fetchRate: jest.fn(),
  };
}

describe('CurrencyModule', () => {
  describe('onApplicationBootstrap', () => {
    it('should fail the boot when no provider was ever registered', () => {
      // An empty registry degrades two ways at once and both are silent: every
      // stamp classifies `no-rate-source` and durably marks the order answered
      // WITHOUT a figure, while the settings surface has nothing to select. A
      // loud startup failure is strictly better than either.
      const module = new CurrencyModule(registryWith([]));

      expect(() => module.onApplicationBootstrap()).toThrow(NoExchangeRateProvidersRegisteredError);
    });

    it('should name the missing host module in the failure', () => {
      const module = new CurrencyModule(registryWith([]));

      expect(() => module.onApplicationBootstrap()).toThrow(/FxIntegrationModule/);
    });

    it('should pass once at least one provider is registered', () => {
      const module = new CurrencyModule(registryWith([fakeProvider('nbp')]));

      expect(() => module.onApplicationBootstrap()).not.toThrow();
    });
  });
});
