/**
 * Currency Rate Service Tests
 *
 * @module libs/core/src/currency/application/services/__tests__
 */
import {
  DuplicateExchangeRateError,
  RateUnavailableTransientError,
  RateUnsupportedPairError,
} from '../../../domain/exceptions/exchange-rate.exception';
import { UnregisteredExchangeRateSourceError } from '../../../domain/exceptions/exchange-rate-source.exception';
import type { ExchangeRateProviderPort } from '../../../domain/ports/exchange-rate-provider.port';
import type { ExchangeRateProviderRegistryPort } from '../../../domain/ports/exchange-rate-provider-registry.port';
import type { ExchangeRateRepositoryPort } from '../../../domain/ports/exchange-rate-repository.port';
import type {
  ExchangeRate,
  GetRateInput,
  StoredExchangeRate,
} from '../../../domain/types/exchange-rate.types';
import { CurrencyRateService } from '../currency-rate.service';

const INPUT: GetRateInput = {
  source: 'nbp',
  from: 'EUR',
  to: 'PLN',
  rateDate: '2026-08-13',
};

const FETCHED: ExchangeRate = {
  source: 'nbp',
  from: 'EUR',
  to: 'PLN',
  rateDate: '2026-08-13',
  rate: '4.25000000',
  sourceRef: '149/A/NBP/2026',
  pivotCurrency: null,
  derivation: {
    kind: 'direct',
    legs: [{ pair: 'EUR/PLN', ref: '149/A/NBP/2026', effectiveDate: '2026-08-13' }],
  },
};

const STORED: StoredExchangeRate = {
  ...FETCHED,
  id: 'rate-1',
  fetchedAt: new Date('2026-08-14T06:00:00Z'),
};

describe('CurrencyRateService', () => {
  let provider: jest.Mocked<ExchangeRateProviderPort>;
  let registry: jest.Mocked<ExchangeRateProviderRegistryPort>;
  let repository: jest.Mocked<ExchangeRateRepositoryPort>;
  let service: CurrencyRateService;

  beforeEach(() => {
    provider = {
      name: 'nbp',
      pivotCurrency: 'PLN',
      supports: jest.fn().mockReturnValue(true),
      listSupportedCurrencies: jest.fn().mockReturnValue(['PLN', 'EUR']),
      fetchRate: jest.fn().mockResolvedValue(FETCHED),
    } as unknown as jest.Mocked<ExchangeRateProviderPort>;

    registry = {
      register: jest.fn(),
      get: jest.fn().mockReturnValue(provider),
      has: jest.fn().mockReturnValue(true),
      list: jest.fn().mockReturnValue([provider]),
    };

    repository = {
      findByKey: jest.fn().mockResolvedValue(null),
      insertIfAbsent: jest.fn().mockResolvedValue(STORED),
    };

    service = new CurrencyRateService(registry, repository);
  });

  describe('registry hit', () => {
    it('should return the existing row without calling the provider', async () => {
      repository.findByKey.mockResolvedValue(STORED);

      const result = await service.getRateFor(INPUT);

      expect(result).toBe(STORED);
      expect(provider.fetchRate).not.toHaveBeenCalled();
      expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('should perform no provider fetch on a second call for the same key', async () => {
      // Five hundred EUR orders on one day cost one provider call, which is the
      // whole reason the registry is keyed by (source, pair, date).
      repository.findByKey.mockResolvedValueOnce(null).mockResolvedValue(STORED);

      await service.getRateFor(INPUT);
      await service.getRateFor(INPUT);

      expect(provider.fetchRate).toHaveBeenCalledTimes(1);
    });
  });

  describe('registry miss', () => {
    it('should fetch from the provider and register the result', async () => {
      const result = await service.getRateFor(INPUT);

      expect(provider.fetchRate).toHaveBeenCalledWith({
        from: 'EUR',
        to: 'PLN',
        on: '2026-08-13',
      });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith(FETCHED);
      expect(result).toBe(STORED);
    });

    it('should key the registry read on the full natural key', async () => {
      await service.getRateFor(INPUT);

      expect(repository.findByKey).toHaveBeenCalledWith(INPUT);
    });
  });

  describe('resolveLikelyPublicationDay probe (#2777)', () => {
    it('should key the pre-fetch read on the resolved publication day when the provider declares the method', async () => {
      provider.resolveLikelyPublicationDay = jest.fn().mockReturnValue('2026-08-14');
      repository.findByKey.mockResolvedValue(STORED);
      const saturdayCandidate = { ...INPUT, rateDate: '2026-08-15' };

      const result = await service.getRateFor(saturdayCandidate);

      expect(provider.resolveLikelyPublicationDay).toHaveBeenCalledWith('2026-08-15');
      expect(repository.findByKey).toHaveBeenCalledWith({ ...saturdayCandidate, rateDate: '2026-08-14' });
      expect(provider.fetchRate).not.toHaveBeenCalled();
      expect(result).toBe(STORED);
    });

    it('should key the pre-fetch read on the raw candidate when the provider declares nothing', async () => {
      // `provider` (the beforeEach default) carries no `resolveLikelyPublicationDay`
      // property at all — proving the probe, not the type, governs behaviour.
      expect('resolveLikelyPublicationDay' in provider).toBe(false);

      await service.getRateFor(INPUT);

      expect(repository.findByKey).toHaveBeenCalledWith(INPUT);
    });

    it('should fall through to fetchRate when the resolved day still misses the cache', async () => {
      provider.resolveLikelyPublicationDay = jest.fn().mockReturnValue('2026-08-14');
      repository.findByKey.mockResolvedValue(null);
      const saturdayCandidate = { ...INPUT, rateDate: '2026-08-15' };

      const result = await service.getRateFor(saturdayCandidate);

      expect(repository.findByKey).toHaveBeenCalledWith({ ...saturdayCandidate, rateDate: '2026-08-14' });
      expect(provider.fetchRate).toHaveBeenCalledWith({ from: 'EUR', to: 'PLN', on: '2026-08-15' });
      expect(repository.insertIfAbsent).toHaveBeenCalledWith(FETCHED);
      expect(result).toBe(STORED);
    });
  });

  describe('duplicate recovery', () => {
    it('should re-select the winner rather than propagating DuplicateExchangeRateError', async () => {
      repository.insertIfAbsent.mockRejectedValue(
        new DuplicateExchangeRateError('nbp', 'EUR', 'PLN', '2026-08-13')
      );
      repository.findByKey.mockResolvedValueOnce(null).mockResolvedValue(STORED);

      await expect(service.getRateFor(INPUT)).resolves.toBe(STORED);
    });

    it('should re-select on the RESOLVED rate date when the provider walked back', async () => {
      // A weekend candidate resolves onto an earlier published day, so the row
      // already exists under that earlier date while the pre-fetch read looked
      // under the candidate.
      const walkedBack: ExchangeRate = { ...FETCHED, rateDate: '2026-08-07' };
      const storedWalkedBack: StoredExchangeRate = { ...STORED, rateDate: '2026-08-07' };
      provider.fetchRate.mockResolvedValue(walkedBack);
      repository.insertIfAbsent.mockRejectedValue(
        new DuplicateExchangeRateError('nbp', 'EUR', 'PLN', '2026-08-07')
      );
      repository.findByKey.mockResolvedValueOnce(null).mockResolvedValue(storedWalkedBack);

      const result = await service.getRateFor({ ...INPUT, rateDate: '2026-08-08' });

      expect(repository.findByKey).toHaveBeenLastCalledWith({
        source: 'nbp',
        from: 'EUR',
        to: 'PLN',
        rateDate: '2026-08-07',
      });
      expect(result).toBe(storedWalkedBack);
    });

    it('should re-fetch on EVERY call for a candidate that resolves by walk-back', async () => {
      // The registry absorbs a repeat lookup only when the candidate day is
      // ITSELF a publication day. A weekend candidate resolves onto an earlier
      // published date, so nothing is ever written under the candidate, the
      // pre-fetch read keeps missing, and each order carrying it costs a live
      // provider call. Pinned because the file header used to claim otherwise;
      // memoising the mapping is deferred to #2124.
      const walkedBack: ExchangeRate = { ...FETCHED, rateDate: '2026-08-07' };
      const storedWalkedBack: StoredExchangeRate = { ...STORED, rateDate: '2026-08-07' };
      provider.fetchRate.mockResolvedValue(walkedBack);
      repository.insertIfAbsent
        .mockResolvedValueOnce(storedWalkedBack)
        .mockRejectedValue(new DuplicateExchangeRateError('nbp', 'EUR', 'PLN', '2026-08-07'));
      // The candidate is never registered, so its read misses every time; the
      // resolved-date re-read after the duplicate finds the winner.
      repository.findByKey.mockImplementation((key) =>
        Promise.resolve(key.rateDate === '2026-08-07' ? storedWalkedBack : null)
      );

      const weekendCandidate = { ...INPUT, rateDate: '2026-08-08' };
      await service.getRateFor(weekendCandidate);
      await service.getRateFor(weekendCandidate);

      expect(provider.fetchRate).toHaveBeenCalledTimes(2);
    });

    it('should re-fetch only ONCE for a candidate that is itself a publication day', async () => {
      // The other side of the same rule: the write lands under the candidate,
      // so the second call is served from the registry.
      repository.findByKey.mockResolvedValueOnce(null).mockResolvedValue(STORED);

      await service.getRateFor(INPUT);
      await service.getRateFor(INPUT);

      expect(provider.fetchRate).toHaveBeenCalledTimes(1);
      expect(repository.insertIfAbsent).toHaveBeenCalledTimes(1);
    });

    it('should re-raise when the duplicate cannot be re-read', async () => {
      const duplicate = new DuplicateExchangeRateError('nbp', 'EUR', 'PLN', '2026-08-13');
      repository.insertIfAbsent.mockRejectedValue(duplicate);
      repository.findByKey.mockResolvedValue(null);

      await expect(service.getRateFor(INPUT)).rejects.toBe(duplicate);
    });
  });

  describe('failure classification', () => {
    it('should raise a terminal RateUnsupportedPairError when the provider does not quote the pair', async () => {
      // Fails on the first call, not after a full walk-back: maxAttempts
      // defaults to 10, so a 7-day walk-back would cost 70 futile requests.
      provider.supports.mockReturnValue(false);

      await expect(service.getRateFor(INPUT)).rejects.toThrow(RateUnsupportedPairError);
      expect(provider.fetchRate).not.toHaveBeenCalled();
      expect(repository.findByKey).not.toHaveBeenCalled();
    });

    it('should propagate RateUnsupportedPairError from the provider unchanged', async () => {
      // The stamp service, not this one, decides terminal-versus-retry policy.
      const terminal = new RateUnsupportedPairError('nbp', 'EUR', 'PLN', '2026-08-13', 'exhausted');
      provider.fetchRate.mockRejectedValue(terminal);

      await expect(service.getRateFor(INPUT)).rejects.toBe(terminal);
    });

    it('should propagate RateUnavailableTransientError unchanged', async () => {
      const transient = new RateUnavailableTransientError('nbp', 'EUR', 'PLN', '2026-08-13', '503');
      provider.fetchRate.mockRejectedValue(transient);

      await expect(service.getRateFor(INPUT)).rejects.toBe(transient);
    });

    it('should surface an unregistered source as the terminal registry error', async () => {
      registry.get.mockImplementation(() => {
        throw new UnregisteredExchangeRateSourceError('nbp', []);
      });

      await expect(service.getRateFor(INPUT)).rejects.toThrow(UnregisteredExchangeRateSourceError);
      expect(repository.findByKey).not.toHaveBeenCalled();
    });
  });
});
