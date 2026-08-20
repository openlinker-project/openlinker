/**
 * Order FX Read Service
 *
 * Published read seam over the FX aggregates on `order_records`: the observed
 * native currencies and the per-reporting-currency stamped-row counts.
 *
 * A pass-through by design - it owns no policy. The policy that consumes it
 * (the reporting-currency coverage advisory and the era-split warning) lives in
 * the interfaces layer, where composing `orders` with `currency` is legal and
 * where it does not cost the `currency` context its leaf property.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderFxReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type { StampedReportingCurrencyCount } from '../../domain/types/order-fx-read.types';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IOrderFxReadService } from '../interfaces/order-fx-read.service.interface';

@Injectable()
export class OrderFxReadService implements IOrderFxReadService {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort
  ) {}

  async listDistinctNativeCurrencies(): Promise<string[]> {
    return this.orderRecordRepository.listDistinctNativeCurrencies();
  }

  async countStampedByReportingCurrency(): Promise<StampedReportingCurrencyCount[]> {
    return this.orderRecordRepository.countStampedByReportingCurrency();
  }
}
