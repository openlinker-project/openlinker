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
import { OrdersModule } from '@openlinker/core/orders';
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { IntegrationsModule as ApiIntegrationsModule } from '../integrations/integrations.module';
import { ProductCostReadsService } from './application/services/product-cost-reads.service';
import { PRODUCT_COST_READS_SERVICE_TOKEN } from './application/services/product-cost-reads.service.interface';
import { ProductImageProxyService } from './application/services/product-image-proxy.service';
import { ProductCostController } from './http/product-cost.controller';
import { ProductsController, VariantsController } from './http/products.controller';

@Module({
  // CoreInventoryModule + ListingsModule back the #1720 list-page display
  // enrichment (stock aggregates + listings coverage), composed here at the
  // interface layer - core ProductsModule stays free of sibling imports to
  // avoid Nest module cycles (inventory/listings already import products).
  // OrdersModule + CoreAnalyticsModule + ApiIntegrationsModule back the cost
  // coverage / work-list reads (#3588): figures from `orders`, the Net-Sales
  // opt-in from `analytics`, connection names for `soldOn`.
  imports: [
    CoreProductsModule,
    IdentifierMappingModule,
    CoreInventoryModule,
    ListingsModule,
    OrdersModule,
    CoreAnalyticsModule,
    ApiIntegrationsModule,
  ],
  // ProductCostController FIRST: its literal `variants/cost` and
  // `:productId/variant-costs` routes must win over `variants/:variantId` / `:id`.
  controllers: [ProductCostController, ProductsController, VariantsController],
  // #3340 follow-up — serves a product's picture from the shop, because the
  // url the catalogue sync stored is one only the backend can reach. See the
  // service's docblock.
  providers: [
    ProductImageProxyService,
    ProductCostReadsService,
    { provide: PRODUCT_COST_READS_SERVICE_TOKEN, useExisting: ProductCostReadsService },
  ],
})
export class ProductsApiModule {}
