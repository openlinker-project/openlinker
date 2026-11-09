/**
 * Products — public surface
 *
 * Public barrel for the products feature (#609). Cross-feature consumers
 * (today: `features/listings`) import the offer-creation wizard's product
 * picker queries and types from here.
 */
export type {
  Product,
  ProductVariant,
  ProductVariantSummary,
  VariantCost,
  VariantCostInput,
  CostCoverage,
  CostSummary,
  ProductFilters,
  ProductListSort,
  ProductListSortDir,
  ProductListSortField,
  ProductStockFilter,
} from './api/products.types';
export {
  ProductListSortDirValues,
  ProductListSortFieldValues,
  ProductStockFilterValues,
} from './api/products.types';
export { useProductQuery } from './hooks/use-product-query';
export { useVariantQuery } from './hooks/use-variant-query';
export { useVariantCostsQuery } from './hooks/use-variant-costs-query';
export { useSetVariantCostMutation } from './hooks/use-set-variant-cost-mutation';
export { useProductsQuery, useProductRowsQuery } from './hooks/use-products-query';
// #4027 - the products cockpit (pages/products) reads these through the barrel
// rather than reaching into the feature's internals.
export { useProductsTotal } from './hooks/use-products-total';
export {
  useProductCountProbes,
  PRODUCT_COUNT_PROBE_STALE_TIME_MS,
  type ProductCountProbe,
} from './hooks/use-product-count-probes';
export {
  ProductAttentionSummary,
  type ProductAttentionSummaryProps,
  type ProductCostGap,
  type ProductGapConnection,
} from './components/product-attention-summary';
export { deriveProductStaleness, type ProductStalenessView } from './lib/product-staleness';
export { useProductsBatchQuery } from './hooks/use-products-batch-query';
export {
  ProductDetailFields,
  ProductDetailLinks,
  type ProductDetailFieldsProps,
  type ProductDetailLinksProps,
} from './components/product-detail-summary';
export {
  deriveStockStatus,
  DEFAULT_LOW_STOCK_THRESHOLD,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_KPI_TONE,
  STOCK_STATUS_LABEL,
  type StockStatus,
} from './lib/product-stock-status';

// #3567 - a stock correction invalidates the products list and detail caches.
export { productsQueryKeys } from './api/products.query-keys';
export { VariantThumbnail, type VariantThumbnailProps } from './components/variant-thumbnail';
export {
  useCostCoverageQuery,
  useCostSummaryQuery,
  COST_COVERAGE_DAYS,
} from './hooks/use-cost-coverage-query';
