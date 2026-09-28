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
import { ShippingModule as CoreShippingModule } from '@openlinker/core/shipping';
import { ReturnsModule as CoreReturnsModule } from '@openlinker/core/returns';
import { OrdersController } from './http/orders.controller';
import { RefundsController } from './http/refunds.controller';
import { SalesDocumentsController } from './http/sales-documents.controller';
import { OrderColumnPresetsController } from './http/order-column-presets.controller';
import { OrderNotesController } from './http/order-notes.controller';
import { OrderTagsController } from './http/order-tags.controller';
import { OrderTagAssignmentsController } from './http/order-tag-assignments.controller';

@Module({
  // CoreMappingsModule (#1791) provides FULFILLMENT_ROUTING_SERVICE_TOKEN —
  // the orders controller resolves the delivery-routing-resolution
  // projection off the same service the shipping dispatch seam (#835) uses.
  // CoreInventoryModule (#2349) provides RESERVATION_SHORTFALL_SERVICE_TOKEN —
  // the order-detail read projects still-open shortfall episodes. Composed
  // HERE, in the host app's interface layer, exactly as the invoice projection
  // already is: it adds no `orders -> inventory` edge inside `libs/core`.
  //
  // CoreShippingModule (#3528) provides SHIPMENT_QUERY_SERVICE_TOKEN — the
  // orders search bar resolves a tracking-number query into its owning
  // order id(s) BEFORE asking `orders`, because `orders` may not import
  // `shipping` (`shipping` already depends on `orders`).
  //
  // CoreReturnsModule (#2998) provides RETURNS_SERVICE_TOKEN — the "open
  // return" badge and filter, for the identical acyclic reason: `returns`
  // may not import `orders` back, so the composition happens here.
  imports: [
    CoreOrdersModule,
    CoreInvoicingModule,
    CoreMappingsModule,
    CoreInventoryModule,
    CoreShippingModule,
    CoreReturnsModule,
  ],
  controllers: [
    OrdersController,
    RefundsController,
    SalesDocumentsController,
    OrderColumnPresetsController,
    OrderNotesController,
    OrderTagsController,
    OrderTagAssignmentsController,
  ],
})
export class OrdersModule {}
