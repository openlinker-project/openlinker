/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the products module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/products
 */

// Token for dependency injection (interfaces can't be used as values)
export const PRODUCT_REPOSITORY_TOKEN = Symbol('ProductRepositoryPort');
export const PRODUCT_VARIANT_REPOSITORY_TOKEN = Symbol('ProductVariantRepositoryPort');
export const PRODUCTS_SERVICE_TOKEN = Symbol('IProductsService');

