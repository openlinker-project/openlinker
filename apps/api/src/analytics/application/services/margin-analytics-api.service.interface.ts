/**
 * Margin Analytics API Service Interface
 *
 * Composes the core margin reads (#3588, `orders`) with catalogue display
 * metadata (`products`) for the product and variant tables.
 *
 * @module apps/api/src/analytics/application/services
 */
import type { MarginProductFilters, SalesAnalyticsFilters } from '@openlinker/core/orders';
import type {
  MarginProductsResponseDto,
  MarginProductVariantsResponseDto,
} from '../../http/dto/margin-analytics-response.dto';

export const MARGIN_ANALYTICS_API_SERVICE_TOKEN = Symbol('IMarginAnalyticsApiService');

export interface IMarginAnalyticsApiService {
  getMarginProducts(
    filters: MarginProductFilters,
    includeBackfilledTaxRatesInNetSales?: boolean
  ): Promise<MarginProductsResponseDto>;

  getMarginProductVariants(
    productId: string,
    filters: SalesAnalyticsFilters,
    includeBackfilledTaxRatesInNetSales?: boolean
  ): Promise<MarginProductVariantsResponseDto>;
}
