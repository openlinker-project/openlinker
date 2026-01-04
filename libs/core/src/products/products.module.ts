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
import {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
} from './products.tokens';

// Re-export tokens for convenience
export {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
} from './products.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductOrmEntity, ProductVariantOrmEntity]),
  ],
  providers: [
    // Provide classes directly first
    ProductRepository,
    ProductVariantRepository,
    ProductsService,
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
    // Also provide as string tokens for convenience
    {
      provide: 'ProductRepositoryPort',
      useExisting: PRODUCT_REPOSITORY_TOKEN,
    },
    {
      provide: 'ProductVariantRepositoryPort',
      useExisting: PRODUCT_VARIANT_REPOSITORY_TOKEN,
    },
    {
      provide: 'IProductsService',
      useExisting: PRODUCTS_SERVICE_TOKEN,
    },
  ],
  exports: [
    PRODUCT_REPOSITORY_TOKEN,
    PRODUCT_VARIANT_REPOSITORY_TOKEN,
    PRODUCTS_SERVICE_TOKEN,
    'ProductRepositoryPort',
    'ProductVariantRepositoryPort',
    'IProductsService',
  ],
})
export class ProductsModule {}

