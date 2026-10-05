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
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule as CoreIdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { OrdersController } from './http/orders.controller';
import { RefundsController } from './http/refunds.controller';
import { SalesDocumentsController } from './http/sales-documents.controller';
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
  // CoreIntegrationsModule + CoreIdentifierMappingModule (#3365) supply the two
  // seams `SourceFulfillmentStatusService` composes: resolving the order's own
  // source adapter, and resolving the source-native order id to ask about.
  imports: [
    CoreOrdersModule,
    CoreInvoicingModule,
    CoreMappingsModule,
    CoreInventoryModule,
    CoreIntegrationsModule,
    CoreIdentifierMappingModule,
  ],
  controllers: [OrdersController, RefundsController, SalesDocumentsController],
  // #3365 - composed HERE rather than in `libs/core/orders`, for the reason the
  // invoice and shortfall projections above already are: it reaches an
  // `integrations` adapter, and doing that inside core would add an
  // `orders -> integrations` runtime edge for one read surface.
  providers: [
    SourceFulfillmentStatusService,
    { provide: SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN, useExisting: SourceFulfillmentStatusService },
  ],
})
export class OrdersModule {}
