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
export const MASTER_PRODUCT_SYNC_SERVICE_TOKEN = Symbol('IMasterProductSyncService');
export const AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN = Symbol('IAutoMatchVariantOffersService');
export const TAX_RATE_JOURNAL_REPOSITORY_TOKEN = Symbol('TaxRateJournalRepositoryPort');
export const TAX_RATE_JOURNAL_SERVICE_TOKEN = Symbol('ITaxRateJournalService');
// Recurring price propagation hook (#3143, ADR-072) — see the port's own
// docblock for why this is optional and host-bound rather than a direct
// products -> listings module import.
export const PRICE_CHANGE_OBSERVER_TOKEN = Symbol('PriceChangeObserverPort');

