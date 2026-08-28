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
import type { TopProductFilters } from '@openlinker/core/orders';
import type { TopProductsResponseDto } from '../../http/dto/top-products-response.dto';

export const TOP_PRODUCTS_SERVICE_TOKEN = Symbol('ITopProductsService');

export interface ITopProductsService {
  getTopProducts(
    filters: TopProductFilters,
    includeBackfilledTaxRatesInNetSales?: boolean
  ): Promise<TopProductsResponseDto>;
}
