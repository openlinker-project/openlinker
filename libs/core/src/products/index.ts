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
} from './products.tokens';

// Ports
export {
  ProductMasterPort,
  Product,
  ProductVariant,
  Category,
} from './domain/ports/product-master.port';
export { ProductRepositoryPort } from './domain/ports/product-repository.port';
export { ProductVariantRepositoryPort } from './domain/ports/product-variant-repository.port';

// Domain Entities
export { Product as ProductEntity } from './domain/entities/product.entity';
export { ProductVariant as ProductVariantEntity } from './domain/entities/product-variant.entity';

// Domain Utils
export { normalizeBarcode } from './domain/utils/barcode-normalization';

// Application Services
export { IProductsService } from './application/services/products.service.interface';
export { ProductsService } from './application/services/products.service';
export { IMasterProductSyncService, MasterProductSyncResult } from './application/services/master-product-sync.service.interface';
export { MasterProductSyncService } from './application/services/master-product-sync.service';

// Types
export {
  ProductFilters,
  ProductCreate,
  ProductUpdate,
  ProductVariantCreate,
} from './domain/types/product.types';

// ORM Entities (exported for testing and TypeORM CLI usage)
export { ProductOrmEntity } from './infrastructure/persistence/entities/product.orm-entity';
export { ProductVariantOrmEntity } from './infrastructure/persistence/entities/product-variant.orm-entity';



