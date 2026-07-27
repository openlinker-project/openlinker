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
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { ListingsModule } from '@openlinker/core/listings/services';
import { ProductsController, VariantsController } from './http/products.controller';

@Module({
  // CoreInventoryModule + ListingsModule back the #1720 list-page display
  // enrichment (stock aggregates + listings coverage), composed here at the
  // interface layer - core ProductsModule stays free of sibling imports to
  // avoid Nest module cycles (inventory/listings already import products).
  imports: [CoreProductsModule, IdentifierMappingModule, CoreInventoryModule, ListingsModule],
  controllers: [ProductsController, VariantsController],
})
export class ProductsApiModule {}
