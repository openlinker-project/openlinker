/**
 * Products Module Exports
 *
 * Public API for the products module. Exports ports, types, domain entities,
 * and services for use by other modules and adapters.
 *
 * @module libs/core/src/products
 */

// Module
export { ProductsModule } from './products.module';

// Tokens
export * from './products.tokens';

// Ports
export {
  ProductMasterPort,
  Category,
} from './domain/ports/product-master.port';
export { ProductRepositoryPort } from './domain/ports/product-repository.port';
export { ProductVariantRepositoryPort } from './domain/ports/product-variant-repository.port';

// Domain Entities
export { Product } from './domain/entities/product.entity';
export { ProductVariant } from './domain/entities/product-variant.entity';

// Domain Exceptions
export { MasterProductNotFoundError } from './domain/exceptions/master-product-not-found.error';

// Master-deletion event contract (#1599)
export {
  MASTER_DELETION_EVENT_STREAM,
  MASTER_VARIANT_STALE_EVENT,
  MASTER_PRODUCT_STALE_EVENT,
  MASTER_DELETION_EVENT_SCHEMA_VERSION,
  MasterDeletionEventPayload,
} from './domain/types/master-deletion-events.types';

// Domain Utils
export { normalizeBarcode, normalizeToEan13 } from './domain/utils/barcode-normalization';
export { coverImageUrl } from './domain/utils/product-cover-image';

// Application Services
export { IProductsService } from './application/services/products.service.interface';
export { ProductsService } from './application/services/products.service';
export {
  IMasterProductSyncService,
  MasterProductSyncResult,
  PruneSkippedReason,
  PruneSkippedReasonValues,
} from './application/services/master-product-sync.service.interface';
export { MasterProductSyncService } from './application/services/master-product-sync.service';
export { IAutoMatchVariantOffersService } from './application/services/auto-match-variant-offers.service.interface';
export { AutoMatchVariantOffersService } from './application/services/auto-match-variant-offers.service';

// Auto-match types
export { AutoMatchResult, AutoMatchOptions, AutoMatchMethod, MatchError, AutoMatchVariantsJobPayload, OfferIdentifiers, MatchResult } from './application/types/auto-match.types';

// Types
export {
  ProductFilters,
  ProductCreate,
  ProductUpdate,
  ProductVariantCreate,
  ProductListFilters,
  ProductVariantListFilters,
  ProductPagination,
  PaginatedProducts,
  PaginatedProductVariants,
  ProductStockFilter,
  ProductStockFilterValues,
  ProductListSortField,
  ProductListSortFieldValues,
  ProductListSortDirection,
  ProductListSortDirectionValues,
  ProductListSort,
  LOW_STOCK_THRESHOLD,
} from './domain/types/product.types';

// ProductMasterPort sub-capabilities (#2220, ADR-048 decision 1): optional rungs of
// the master capability ladder, extracted into distinct interfaces + co-located type
// guards. Call sites narrow support via `is{Capability}(adapter)`; a master that
// declares nothing stays on the base port's enumerate-only behaviour.
export type {
  ModifiedProductLister,
  ListExternalIdsModifiedSinceInput,
} from './domain/ports/capabilities/modified-product-lister.capability';
export { isModifiedProductLister } from './domain/ports/capabilities/modified-product-lister.capability';

// Neutral per-line tax rate (#2054, ADR-052). The vocabulary a ProductMaster
// answers a tax question in, plus the shape OpenLinker stores that answer as.
export type {
  InheritedTaxRate,
  ResolvedTaxRate,
  StoredTaxRate,
  TaxRateResolution,
  TaxRateSource,
  TaxRateState,
  TaxRateUnknownReason,
  UnknownTaxRate,
} from './domain/types/tax-rate.types';
export {
  TaxRateSourceValues,
  TaxRateStateValues,
  TaxRateUnknownReasonValues,
  effectiveTaxRate,
  isResolvedTaxRate,
  taxRateState,
} from './domain/types/tax-rate.types';
export type {
  ProductTaxRateReader,
  ReadProductTaxRateInput,
} from './domain/ports/capabilities/product-tax-rate-reader.capability';
export { isProductTaxRateReader } from './domain/ports/capabilities/product-tax-rate-reader.capability';

// Append-only tax-rate provenance journal (#2250, ADR-052 § 4).
export type {
  TaxRateJournalEntry,
  TaxRateJournalOrigin,
  TaxRateObservation,
} from './domain/types/tax-rate-journal.types';
export {
  TaxRateJournalOriginValues,
  isNewTaxRateObservation,
} from './domain/types/tax-rate-journal.types';
export type { TaxRateJournalRepositoryPort } from './domain/ports/tax-rate-journal-repository.port';
export type { ITaxRateJournalService } from './application/services/tax-rate-journal.service.interface';

// ORM entities are exposed on the host-only `@openlinker/core/products/orm-entities`
// sub-path (#594). Plugins must not import them from here.



