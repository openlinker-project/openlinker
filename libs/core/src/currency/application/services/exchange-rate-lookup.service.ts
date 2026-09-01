/**
 * Exchange Rate Lookup Service
 *
 * Implements the pure registry read behind `GET /currency/rates` (#2778).
 * One-line delegation to `ExchangeRateRepositoryPort.findByKey` — the whole
 * point of this class existing separately from `CurrencyRateService` is that
 * it has no other method to accidentally call, so an HTTP caller can never
 * reach the provider-fetching `getRateFor` through this seam.
 *
 * @module libs/core/src/currency/application/services
 * @implements {IExchangeRateLookupService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { EXCHANGE_RATE_REPOSITORY_TOKEN } from '../../currency.tokens';
import { ExchangeRateRepositoryPort } from '../../domain/ports/exchange-rate-repository.port';
import type { ExchangeRateKey, StoredExchangeRate } from '../../domain/types/exchange-rate.types';
import type { IExchangeRateLookupService } from '../interfaces/exchange-rate-lookup.service.interface';

@Injectable()
export class ExchangeRateLookupService implements IExchangeRateLookupService {
  constructor(
    @Inject(EXCHANGE_RATE_REPOSITORY_TOKEN)
    private readonly repository: ExchangeRateRepositoryPort
  ) {}

  async findRate(key: ExchangeRateKey): Promise<StoredExchangeRate | null> {
    return this.repository.findByKey(key);
  }
}
