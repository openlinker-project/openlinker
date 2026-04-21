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
export {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
} from './products.tokens';

// Ports
export {
  ProductMasterPort,
  Product,
  Category,
} from './domain/ports/product-master.port';
export { ProductRepositoryPort } from './domain/ports/product-repository.port';
export { ProductVariantRepositoryPort } from './domain/ports/product-variant-repository.port';

// Domain Entities
export { Product as ProductEntity } from './domain/entities/product.entity';
export { ProductVariant } from './domain/entities/product-variant.entity';

// Domain Utils
export { normalizeBarcode, normalizeToEan13 } from './domain/utils/barcode-normalization';

// Application Services
export { IProductsService } from './application/services/products.service.interface';
export { ProductsService } from './application/services/products.service';
export { IMasterProductSyncService, MasterProductSyncResult } from './application/services/master-product-sync.service.interface';
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
} from './domain/types/product.types';

// ORM Entities (exported for testing and TypeORM CLI usage)
export { ProductOrmEntity } from './infrastructure/persistence/entities/product.orm-entity';
export { ProductVariantOrmEntity } from './infrastructure/persistence/entities/product-variant.orm-entity';



