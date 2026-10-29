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
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { InvoicingModule as CoreInvoicingModule } from '@openlinker/core/invoicing';
import { MappingsModule as CoreMappingsModule } from '@openlinker/core/mappings';
import { FulfillmentModule as CoreFulfillmentModule } from '@openlinker/core/fulfillment';
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';
import { ShippingModule as CoreShippingModule } from '@openlinker/core/shipping';
import { ReturnsModule as CoreReturnsModule } from '@openlinker/core/returns';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule as CoreIdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { OrdersController } from './http/orders.controller';
import { RefundsController } from './http/refunds.controller';
import { SalesDocumentsController } from './http/sales-documents.controller';
import { OrderColumnPresetsController } from './http/order-column-presets.controller';
import { OrderNotesController } from './http/order-notes.controller';
import { OrderLineCostsController } from './http/order-line-costs.controller';
import { OrderTagsController } from './http/order-tags.controller';
import { OrderTagAssignmentsController } from './http/order-tag-assignments.controller';
import { OrderExportsController } from './http/order-exports.controller';
import { SourceFulfillmentStatusService } from './application/services/source-fulfillment-status.service';
import { SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN } from './application/interfaces/source-fulfillment-status.service.interface';

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
  //
  // CoreIntegrationsModule + CoreIdentifierMappingModule (#3365) supply the two
  // seams `SourceFulfillmentStatusService` composes: resolving the order's own
  // source adapter, and resolving the source-native order id to ask about.
  imports: [
    CoreOrdersModule,
    // #3588: ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN - the net-sales era setting the line-cost read honours.
    CoreAnalyticsModule,
    CoreInvoicingModule,
    CoreMappingsModule,
    CoreInventoryModule,
    // CoreFulfillmentModule (#3482) provides FULFILLMENT_WORK_QUERY_SERVICE_TOKEN —
    // the list row's packing stage for an order OpenLinker handles itself. Composed
    // here, in the interface layer, like the shortfall and open-return projections.
    CoreFulfillmentModule,
    CoreShippingModule,
    CoreReturnsModule,
    // CoreSyncModule (#3534) provides JOB_ENQUEUE_TOKEN — the export
    // controller enqueues its own `orders.export` driver job, the
    // `AnalyticsRemediationController` precedent.
    CoreSyncModule,
    CoreIntegrationsModule,
    CoreIdentifierMappingModule,
  ],
  // ORDER MATTERS (#3507 G03-10). Express matches routes in registration
  // order and Nest registers controllers in this array's order, so the two
  // controllers with a STATIC prefix under `orders/` must come before
  // `OrdersController`: its `@Get(':internalOrderId')` matches any
  // two-segment path, and registered first it answered
  // `GET /orders/column-presets` with "Order not found: column-presets".
  // Their three-segment routes (`workspace-default`, `:id`, `:runId`) were
  // never shadowed, which is why saving a preset worked while listing failed.
  controllers: [
    OrderColumnPresetsController,
    OrderExportsController,
    OrdersController,
    RefundsController,
    SalesDocumentsController,
    OrderNotesController,
    OrderLineCostsController,
    OrderTagsController,
    OrderTagAssignmentsController,
  ],
  // #3365 - composed HERE rather than in `libs/core/orders`, for the reason the
  // invoice and shortfall projections above already are: it reaches an
  // `integrations` adapter, and doing that inside core would add an
  // `orders -> integrations` runtime edge for one read surface.
  providers: [
    SourceFulfillmentStatusService,
    {
      provide: SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN,
      useExisting: SourceFulfillmentStatusService,
    },
  ],
})
export class OrdersModule {}
