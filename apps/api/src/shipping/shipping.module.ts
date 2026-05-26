/**
 * Shipping API Module
 *
 * Wires the shipment HTTP layer (#846). Imports the core `ShippingModule` for
 * the query / dispatch / cancellation service bindings (and the underlying
 * `ShipmentRepositoryPort` + dispatch seam from #763/#835), plus `OrdersModule`
 * for `ORDER_RECORD_SERVICE_TOKEN` — the controller resolves each shipment's
 * `orderId → Order.customerId` for the customer column (#770). Registers the
 * shipment controller. Mirrors `MappingsApiModule`.
 *
 * @module apps/api/src/shipping
 */
import { Module } from '@nestjs/common';
import { ShippingModule } from '@openlinker/core/shipping';
import { OrdersModule } from '@openlinker/core/orders';

import { ShipmentController } from './http/shipment.controller';

@Module({
  imports: [ShippingModule, OrdersModule],
  controllers: [ShipmentController],
})
export class ShippingApiModule {}
