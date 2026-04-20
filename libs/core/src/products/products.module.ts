/**
 * Products Module
 *
 * NestJS module for products functionality. Configures TypeORM entities,
 * repositories, and services. Exports the products service and ports
 * for use in other modules.
 *
 * @module libs/core/src/products
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductOrmEntity } from './infrastructure/persistence/entities/product.orm-entity';
import { ProductVariantOrmEntity } from './infrastructure/persistence/entities/product-variant.orm-entity';
import { ProductRepository } from './infrastructure/persistence/repositories/product.repository';
import { ProductVariantRepository } from './infrastructure/persistence/repositories/product-variant.repository';
import { ProductsService } from './application/services/products.service';
import { MasterProductSyncService } from './application/services/master-product-sync.service';
import { AutoMatchVariantOffersService } from './application/services/auto-match-variant-offers.service';
import {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
} from './products.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';

// Re-export tokens for convenience
export {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from './products.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductOrmEntity, ProductVariantOrmEntity]),
    IntegrationsModule,
    IdentifierMappingModule,
  ],
  providers: [
    // Provide classes directly first
    ProductRepository,
    ProductVariantRepository,
    ProductsService,
    MasterProductSyncService,
    AutoMatchVariantOffersService,
    // Then provide token bindings using useExisting
    {
      provide: PRODUCT_REPOSITORY_TOKEN,
      useExisting: ProductRepository,
    },
    {
      provide: PRODUCT_VARIANT_REPOSITORY_TOKEN,
      useExisting: ProductVariantRepository,
    },
    {
      provide: PRODUCTS_SERVICE_TOKEN,
      useExisting: ProductsService,
    },
    {
      provide: MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
      useExisting: MasterProductSyncService,
    },
    {
      provide: AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
      useExisting: AutoMatchVariantOffersService,
    },
  ],
  exports: [
    PRODUCT_REPOSITORY_TOKEN,
    PRODUCT_VARIANT_REPOSITORY_TOKEN,
    PRODUCTS_SERVICE_TOKEN,
    MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
    AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
  ],
})
export class ProductsModule {}

