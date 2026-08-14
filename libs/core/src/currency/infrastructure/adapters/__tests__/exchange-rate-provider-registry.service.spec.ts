/**
 * Exchange Rate Provider Registry Service Tests
 *
 * @module libs/core/src/currency/infrastructure/adapters/__tests__
 */
import {
  DuplicateExchangeRateSourceError,
  UnregisteredExchangeRateSourceError,
} from '../../../domain/exceptions/exchange-rate-source.exception';
import type { ExchangeRateProviderPort } from '../../../domain/ports/exchange-rate-provider.port';
import type { ExchangeRateSource } from '../../../domain/types/exchange-rate.types';
import { ExchangeRateProviderRegistryService } from '../exchange-rate-provider-registry.service';

function stubProvider(name: ExchangeRateSource): ExchangeRateProviderPort {
  return {
    name,
    pivotCurrency: null,
    supports: () => true,
    listSupportedCurrencies: () => ['PLN', 'EUR'],
    fetchRate: () => Promise.reject(new Error('not called')),
  };
}

describe('ExchangeRateProviderRegistryService', () => {
  let registry: ExchangeRateProviderRegistryService;

  beforeEach(() => {
    registry = new ExchangeRateProviderRegistryService();
  });

  it('should be empty until an integration module registers a provider', () => {
    // Empty-on-construct is what keeps libs/core ignorant of which providers
    // exist - the same posture AdapterRegistryService has (#570/#571).
    expect(registry.list()).toEqual([]);
    expect(registry.has('nbp')).toBe(false);
  });

  it('should return a registered provider', () => {
    const nbp = stubProvider('nbp');
    registry.register(nbp);

    expect(registry.get('nbp')).toBe(nbp);
    expect(registry.has('nbp')).toBe(true);
  });

  it('should hold both shipped providers simultaneously', () => {
    const nbp = stubProvider('nbp');
    const ecb = stubProvider('ecb');

    registry.register(nbp);
    registry.register(ecb);

    expect(registry.list()).toEqual([nbp, ecb]);
    expect(registry.get('ecb')).toBe(ecb);
  });

  it('should throw DuplicateExchangeRateSourceError on a second registration of the same source', () => {
    registry.register(stubProvider('nbp'));

    expect(() => registry.register(stubProvider('nbp'))).toThrow(DuplicateExchangeRateSourceError);
  });

  it('should not let a duplicate registration shadow the first provider', () => {
    const first = stubProvider('nbp');
    const second = stubProvider('nbp');
    registry.register(first);

    expect(() => registry.register(second)).toThrow();
    expect(registry.get('nbp')).toBe(first);
  });

  it('should throw the terminal UnregisteredExchangeRateSourceError for an unknown source', () => {
    // Terminal, never transient: no retry makes a module appear in the DI graph.
    expect(() => registry.get('ecb')).toThrow(UnregisteredExchangeRateSourceError);
  });

  it('should name the registered sources on the unregistered error', () => {
    registry.register(stubProvider('nbp'));

    try {
      registry.get('ecb');
      fail('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnregisteredExchangeRateSourceError);
      expect((error as UnregisteredExchangeRateSourceError).registeredSources).toEqual(['nbp']);
    }
  });
});
