/**
 * Orders API Module
 *
 * NestJS module for order record read API endpoints. Imports core orders
 * module and registers the orders controller.
 *
 * @module apps/api/src/orders
 */
import { Module } from '@nestjs/common';
import {
  OrderChangesModule as CoreOrderChangesModule,
  OrdersModule as CoreOrdersModule,
} from '@openlinker/core/orders';
import { FiscalizationModule as CoreFiscalizationModule } from '@openlinker/core/fiscalization';
import { FulfillmentModule as CoreFulfillmentModule } from '@openlinker/core/fulfillment';
import { InvoicingModule as CoreInvoicingModule } from '@openlinker/core/invoicing';
import { MappingsModule as CoreMappingsModule } from '@openlinker/core/mappings';
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
import { OrderTagsController } from './http/order-tags.controller';
import { OrderTagAssignmentsController } from './http/order-tag-assignments.controller';
import { OrderExportsController } from './http/order-exports.controller';
import { SourceFulfillmentStatusService } from './application/services/source-fulfillment-status.service';
import { SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN } from './application/interfaces/source-fulfillment-status.service.interface';
import { OrderCancellationService } from './application/services/order-cancellation.service';
import { ORDER_CANCELLATION_SERVICE_TOKEN } from './application/interfaces/order-cancellation.service.interface';
import { OrderEditService } from './application/services/order-edit.service';
import { ORDER_EDIT_SERVICE_TOKEN } from './application/interfaces/order-edit.service.interface';
import { OrderEditsController } from './http/order-edits.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

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
  //
  // #3540 - the operator cancel composes `orders`, `shipping`, `invoicing`,
  // `fiscalization` and `fulfillment`. It is composed HERE because `shipping`
  // already imports `orders`, so core's own orders module cannot import it back.
  // CoreOrderChangesModule is the ADR-044 leaf module that provides
  // ORDER_CHANGE_SERVICE_TOKEN.
  imports: [
    CoreOrdersModule,
    CoreOrderChangesModule,
    CoreFiscalizationModule,
    CoreFulfillmentModule,
    CoreInvoicingModule,
    CoreMappingsModule,
    CoreInventoryModule,
    CoreShippingModule,
    CoreReturnsModule,
    // CoreSyncModule (#3534) provides JOB_ENQUEUE_TOKEN — the export
    // controller enqueues its own `orders.export` driver job, the
    // `AnalyticsRemediationController` precedent.
    CoreSyncModule,
    CoreIntegrationsModule,
    CoreIdentifierMappingModule,
    // The APP-LAYER integrations module (#3542) supplies CONNECTION_SERVICE_TOKEN:
    // the order edit reads a work holder's connection to tell OpenLinker's own
    // executor from a third party. No cycle - it imports only core modules.
    IntegrationsModule,
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
    OrderEditsController,
    OrdersController,
    RefundsController,
    SalesDocumentsController,
    OrderNotesController,
    OrderTagsController,
    OrderTagAssignmentsController,
  ],
  // #3365 - composed HERE rather than in `libs/core/orders`, for the reason the
  // invoice and shortfall projections above already are: it reaches an
  // `integrations` adapter, and doing that inside core would add an
  // `orders -> integrations` runtime edge for one read surface.
  providers: [
    OrderCancellationService,
    { provide: ORDER_CANCELLATION_SERVICE_TOKEN, useExisting: OrderCancellationService },
    // #3542 - composed HERE for the reason the cancel above is: it needs `shipping`.
    OrderEditService,
    { provide: ORDER_EDIT_SERVICE_TOKEN, useExisting: OrderEditService },
    SourceFulfillmentStatusService,
    {
      provide: SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN,
      useExisting: SourceFulfillmentStatusService,
    },
  ],
})
export class OrdersModule {}
