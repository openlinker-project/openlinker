/**
 * Exchange Rate Lookup Service Spec (#2778)
 *
 * @module libs/core/src/currency/application/services/__tests__
 */
import type { ExchangeRateRepositoryPort } from '../../../domain/ports/exchange-rate-repository.port';
import type { StoredExchangeRate } from '../../../domain/types/exchange-rate.types';
import { ExchangeRateLookupService } from '../exchange-rate-lookup.service';

function storedRate(): StoredExchangeRate {
  return {
    id: 'rate_1',
    source: 'nbp',
    from: 'EUR',
    to: 'PLN',
    rateDate: '2026-08-29',
    rate: '4.2500',
    sourceRef: '149/A/NBP/2026',
    pivotCurrency: null,
    derivation: { kind: 'direct', legs: [] },
    fetchedAt: new Date('2026-08-29T12:00:00.000Z'),
  };
}

describe('ExchangeRateLookupService', () => {
  let repository: jest.Mocked<Pick<ExchangeRateRepositoryPort, 'findByKey'>>;
  let service: ExchangeRateLookupService;

  beforeEach(() => {
    repository = { findByKey: jest.fn() };
    service = new ExchangeRateLookupService(repository as unknown as ExchangeRateRepositoryPort);
  });

  it('should return the repository row verbatim when one exists', async () => {
    const stored = storedRate();
    repository.findByKey.mockResolvedValue(stored);

    await expect(
      service.findRate({ source: 'nbp', from: 'EUR', to: 'PLN', rateDate: '2026-08-29' })
    ).resolves.toBe(stored);
  });

  it('should return null when nothing is stored under the key, never throwing or fetching', async () => {
    repository.findByKey.mockResolvedValue(null);

    await expect(
      service.findRate({ source: 'nbp', from: 'EUR', to: 'PLN', rateDate: '2026-08-29' })
    ).resolves.toBeNull();
  });

  it('should pass the key through untouched', async () => {
    repository.findByKey.mockResolvedValue(null);
    const key = { source: 'ecb' as const, from: 'USD', to: 'EUR', rateDate: '2026-01-05' };

    await service.findRate(key);

    expect(repository.findByKey).toHaveBeenCalledWith(key);
    expect(repository.findByKey).toHaveBeenCalledTimes(1);
  });
});
