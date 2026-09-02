/**
 * Orders API Module
 *
 * NestJS module for order record read API endpoints. Imports core orders
 * module and registers the orders controller.
 *
 * @module apps/api/src/orders
 */
import { Module } from '@nestjs/common';
import { OrdersModule as CoreOrdersModule } from '@openlinker/core/orders';
import { InvoicingModule as CoreInvoicingModule } from '@openlinker/core/invoicing';
import { MappingsModule as CoreMappingsModule } from '@openlinker/core/mappings';
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { OrdersController } from './http/orders.controller';
import { RefundsController } from './http/refunds.controller';

@Module({
  // CoreMappingsModule (#1791) provides FULFILLMENT_ROUTING_SERVICE_TOKEN —
  // the orders controller resolves the delivery-routing-resolution
  // projection off the same service the shipping dispatch seam (#835) uses.
  // CoreInventoryModule (#2349) provides RESERVATION_SHORTFALL_SERVICE_TOKEN —
  // the order-detail read projects still-open shortfall episodes. Composed
  // HERE, in the host app's interface layer, exactly as the invoice projection
  // already is: it adds no `orders -> inventory` edge inside `libs/core`.
  imports: [CoreOrdersModule, CoreInvoicingModule, CoreMappingsModule, CoreInventoryModule],
  controllers: [OrdersController, RefundsController],
})
export class OrdersModule {}
