/**
 * Top Products Service Interface
 *
 * Defines the contract for composing the core top-products ranking (#1988,
 * `orders` context) with cross-context enrichment — product display metadata
 * (`products` context) and a per-product listing-coverage flag (`listings`
 * context) — into one HTTP response.
 *
 * @module apps/api/src/analytics/application/services
 */
import type { SalesAnalyticsFilters, TopProductFilters } from '@openlinker/core/orders';
import type { TopProductsResponseDto } from '../../http/dto/top-products-response.dto';
import type { TopProductVariantsResponseDto } from '../../http/dto/top-product-variants-response.dto';

export const TOP_PRODUCTS_SERVICE_TOKEN = Symbol('ITopProductsService');

export interface ITopProductsService {
  getTopProducts(filters: TopProductFilters): Promise<TopProductsResponseDto>;

  /**
   * One product's sales split by variant, per channel (#2765) — the
   * lazily-fetched drill-down behind the Top Products expand panel. See
   * `IOrderRecordService.getTopProductVariantSales` for why this is a
   * separate read rather than a widening of `getTopProducts`.
   */
  getTopProductVariantSales(
    productId: string,
    filters: SalesAnalyticsFilters
  ): Promise<TopProductVariantsResponseDto>;
}
