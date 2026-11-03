/**
 * Margin Analytics Service Interface
 *
 * Contract for the margin reads behind `/analytics/margin*` and the no-cost
 * Data Coverage count (#3588, D27). Every read resolves the system reporting
 * currency ONCE and takes `includeBackfilledPreRollout` as a plain parameter,
 * exactly like the sales and top-products reads (`orders` must not import
 * `analytics`, so the operator's Net-Sales opt-in is threaded in).
 *
 * @module libs/core/src/orders/application/services
 */
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type {
  MarginAnalytics,
  MarginBucket,
  MarginProductFilters,
  MarginProductsResult,
  MarginProductVariantsResult,
} from '../../domain/types/order-margin-analytics.types';

export interface IMarginAnalyticsService {
  /** Headline, trend (day or ISO week, UTC) and per-channel margin for a range. */
  getMargin(
    filters: SalesAnalyticsFilters,
    bucket: MarginBucket,
    includeBackfilledPreRollout?: boolean
  ): Promise<MarginAnalytics>;

  /** Products ranked by gross margin, net revenue or margin %. */
  getMarginProducts(
    filters: MarginProductFilters,
    includeBackfilledPreRollout?: boolean
  ): Promise<MarginProductsResult>;

  /** One product's margin split by variant. */
  getMarginProductVariants(
    productId: string,
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout?: boolean
  ): Promise<MarginProductVariantsResult>;

  /** Lines in net revenue with no usable cost - the `no-cost` coverage count (G11-D). */
  countUncoveredLines(
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout?: boolean
  ): Promise<number>;
}
