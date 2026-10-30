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
} from './api/products.types';
export { useProductQuery } from './hooks/use-product-query';
export { useVariantQuery } from './hooks/use-variant-query';
export { useVariantCostsQuery } from './hooks/use-variant-costs-query';
export { useSetVariantCostMutation } from './hooks/use-set-variant-cost-mutation';
export { useProductsQuery } from './hooks/use-products-query';
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
export { VariantThumbnail, type VariantThumbnailProps } from './components/variant-thumbnail';
export {
  useCostCoverageQuery,
  useCostSummaryQuery,
  COST_COVERAGE_DAYS,
} from './hooks/use-cost-coverage-query';
export { CostCoverageBanner } from './components/cost-coverage-banner';
