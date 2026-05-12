/**
 * Products — public surface
 *
 * Public barrel for the products feature (#609). Cross-feature consumers
 * (today: `features/listings`) import the offer-creation wizard's product
 * picker queries and types from here.
 */
export type { Product, ProductVariant, ProductVariantSummary } from './api/products.types';
export { useProductQuery } from './hooks/use-product-query';
export { useProductsQuery } from './hooks/use-products-query';
