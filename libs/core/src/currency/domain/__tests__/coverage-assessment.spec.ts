/**
 * Coverage Assessment Tests
 *
 * @module libs/core/src/currency/domain/__tests__
 */
import { assessCoverage } from '../coverage-assessment';
import type { ExchangeRateProviderPort } from '../ports/exchange-rate-provider.port';

function providerQuoting(currencies: readonly string[]): ExchangeRateProviderPort {
  return {
    name: 'nbp',
    pivotCurrency: 'PLN',
    supports: (from: string, to: string) =>
      from !== to && currencies.includes(from) && currencies.includes(to),
    listSupportedCurrencies: () => currencies,
    fetchRate: () => Promise.reject(new Error('not called')),
  };
}

describe('assessCoverage', () => {
  it('should report the observed currencies the provider cannot convert from', () => {
    const provider = providerQuoting(['PLN', 'EUR', 'USD']);

    const result = assessCoverage('PLN', ['EUR', 'USD', 'XYZ'], provider);

    expect(result.uncoverableCurrencies).toEqual(['XYZ']);
  });

  it('should return an empty uncoverable set when everything is reachable', () => {
    const provider = providerQuoting(['PLN', 'EUR', 'USD']);

    const result = assessCoverage('PLN', ['EUR', 'USD'], provider);

    expect(result.uncoverableCurrencies).toEqual([]);
  });

  it('should never flag the reporting currency itself', () => {
    // An order already in the reporting currency short-circuits before any
    // provider call, so it can never be uncoverable - even though no provider
    // publishes an identity quote.
    const provider = providerQuoting(['PLN', 'EUR']);

    const result = assessCoverage('PLN', ['PLN', 'EUR'], provider);

    expect(result.uncoverableCurrencies).toEqual([]);
  });

  it('should de-duplicate the observed set', () => {
    const provider = providerQuoting(['PLN', 'EUR']);

    const result = assessCoverage('PLN', ['EUR', 'EUR', 'EUR'], provider);

    expect(result.observedCurrencies).toEqual(['EUR']);
  });

  it('should handle an empty observed set without throwing', () => {
    const provider = providerQuoting(['PLN']);

    expect(assessCoverage('PLN', [], provider)).toEqual({
      reportingCurrency: 'PLN',
      observedCurrencies: [],
      uncoverableCurrencies: [],
    });
  });

  it('should never throw, whatever junk is in the observed set', () => {
    // Blocking on history would let one junk currency in an old snapshot make
    // a legitimate reporting currency permanently unsettable, so this path has
    // to stay total.
    const provider = providerQuoting(['PLN', 'EUR']);

    expect(() => assessCoverage('PLN', ['', '???', 'EURO'], provider)).not.toThrow();
    expect(assessCoverage('PLN', ['', '???', 'EURO'], provider).uncoverableCurrencies).toEqual([
      '',
      '???',
      'EURO',
    ]);
  });
});
