/**
 * Products API Module
 *
 * NestJS module for product and variant read API endpoints. Imports core
 * products module and identifier mapping module, registers controllers.
 *
 * @module apps/api/src/products
 */
import { Module } from '@nestjs/common';
import { ProductsModule as CoreProductsModule } from '@openlinker/core/products';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ProductsController, VariantsController } from './http/products.controller';

@Module({
  imports: [
    CoreProductsModule,
    IdentifierMappingModule,
  ],
  controllers: [ProductsController, VariantsController],
})
export class ProductsApiModule {}
