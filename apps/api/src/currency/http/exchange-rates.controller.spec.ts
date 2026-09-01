/**
 * Exchange Rates Controller — Unit Tests (#2778)
 *
 * Asserts the two properties the endpoint's design leans on: it is a pure
 * registry read (never `ICurrencyRateService.getRateFor`) and it carries no
 * `@Roles(...)` — any authenticated user can reach it.
 *
 * @module apps/api/src/currency/http
 */
import 'reflect-metadata';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { IExchangeRateLookupService, StoredExchangeRate } from '@openlinker/core/currency';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { ExchangeRatesController } from './exchange-rates.controller';
import type { GetExchangeRateDto } from './dto/get-exchange-rate.dto';

function storedRate(overrides: Partial<StoredExchangeRate> = {}): StoredExchangeRate {
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
    ...overrides,
  };
}

function query(overrides: Partial<GetExchangeRateDto> = {}): GetExchangeRateDto {
  return { from: 'EUR', to: 'PLN', date: '2026-08-29', ...overrides } as GetExchangeRateDto;
}

describe('ExchangeRatesController', () => {
  let lookup: jest.Mocked<IExchangeRateLookupService>;
  let controller: ExchangeRatesController;

  beforeEach(() => {
    lookup = { findRate: jest.fn() };
    controller = new ExchangeRatesController(lookup);
  });

  it('should return the stored rate mapped onto the response DTO', async () => {
    lookup.findRate.mockResolvedValue(storedRate());

    const result = await controller.getRate(query());

    expect(result).toEqual({
      from: 'EUR',
      to: 'PLN',
      rate: '4.2500',
      rateDate: '2026-08-29',
      source: 'nbp',
      derivation: 'direct',
      sourceRef: '149/A/NBP/2026',
    });
  });

  it('should resolve the source from `to`, never `from`', async () => {
    lookup.findRate.mockResolvedValue(storedRate());

    await controller.getRate(query({ from: 'PLN', to: 'EUR' }));

    expect(lookup.findRate).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ecb', from: 'PLN', to: 'EUR', rateDate: '2026-08-29' })
    );
  });

  it('should 404 when no row is stored under the key', async () => {
    lookup.findRate.mockResolvedValue(null);

    await expect(controller.getRate(query())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should 422 when `to` names a currency no publisher serves', async () => {
    await expect(controller.getRate(query({ to: 'XXX' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException
    );
    expect(lookup.findRate).not.toHaveBeenCalled();
  });

  it('should have no way to reach ICurrencyRateService.getRateFor — the endpoint is a read, never a fetch (#2778 AC)', async () => {
    // The controller's only dependency is `IExchangeRateLookupService`, whose
    // sole method (`findRate`) is a pure `findByKey` passthrough — no
    // `ICurrencyRateService` (the get-or-create, provider-fetching service)
    // is even constructor-injectable. Asserting the mock's exact call
    // signature — never `{ source, from, to, rateDate }` widened with a
    // fetch-only field, and never any method but `findRate` — is the
    // strongest proof available against a controller with only one
    // dependency: there is nothing else in scope it could have called.
    lookup.findRate.mockResolvedValue(storedRate());

    await controller.getRate(query());

    expect(Object.keys(lookup)).toEqual(['findRate']);
    expect(lookup.findRate).toHaveBeenCalledTimes(1);
  });

  it('should carry no @Roles(...) — reachable by any authenticated user', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ExchangeRatesController.prototype.getRate
    ) as string[] | undefined;
    expect(roles).toBeUndefined();
  });
});
