/**
 * Margin Analytics Service
 *
 * Orchestrates the margin reads (#3588, D27): resolves the reporting currency
 * once per read, fetches the raw rows from the line-item repository and hands
 * them to the pure aggregation. The cost snapshot lives on the lines, so this
 * never touches `products`.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IMarginAnalyticsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { ORDER_LINE_ITEM_REPOSITORY_TOKEN } from '../../orders.tokens';
import {
  buildMarginAnalytics,
  buildMarginProductViews,
  buildMarginVariantViews,
} from '../../domain/order-margin-aggregation';
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type {
  MarginAnalytics,
  MarginBucket,
  MarginProductFilters,
  MarginProductsResult,
  MarginProductVariantsResult,
} from '../../domain/types/order-margin-analytics.types';
import type { IMarginAnalyticsService } from './margin-analytics.service.interface';

@Injectable()
export class MarginAnalyticsService implements IMarginAnalyticsService {
  constructor(
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly lineItemRepository: OrderLineItemRepositoryPort,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService
  ) {}

  async getMargin(
    filters: SalesAnalyticsFilters,
    bucket: MarginBucket,
    includeBackfilledPreRollout = false
  ): Promise<MarginAnalytics> {
    const currency = await this.reportingCurrencySettings.resolve();
    const dailyRows = await this.lineItemRepository.getMarginDailyRows(
      filters,
      currency,
      includeBackfilledPreRollout
    );
    return buildMarginAnalytics({ filters, bucket, dailyRows, currency });
  }

  async getMarginProducts(
    filters: MarginProductFilters,
    includeBackfilledPreRollout = false
  ): Promise<MarginProductsResult> {
    const currency = await this.reportingCurrencySettings.resolve();
    const { rows, total } = await this.lineItemRepository.getMarginProductRanking(
      filters,
      currency,
      includeBackfilledPreRollout
    );
    return { currency, items: buildMarginProductViews(rows), total };
  }

  async getMarginProductVariants(
    productId: string,
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout = false
  ): Promise<MarginProductVariantsResult> {
    const currency = await this.reportingCurrencySettings.resolve();
    const rows = await this.lineItemRepository.getMarginVariantRows(
      productId,
      filters,
      currency,
      includeBackfilledPreRollout
    );
    return { currency, productId, variants: buildMarginVariantViews(rows) };
  }

  async countUncoveredLines(
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout = false
  ): Promise<number> {
    const currency = await this.reportingCurrencySettings.resolve();
    return this.lineItemRepository.countUncoveredLines(
      filters,
      currency,
      includeBackfilledPreRollout
    );
  }
}
