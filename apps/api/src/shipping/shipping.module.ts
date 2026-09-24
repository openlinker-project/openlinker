/**
 * Shipping API Module
 *
 * Wires the shipment HTTP layer (#846). Imports the core `ShippingModule` for
 * the query / dispatch / cancellation service bindings (and the underlying
 * `ShipmentRepositoryPort` + dispatch seam from #763/#835), plus `OrdersModule`
 * for `ORDER_RECORD_SERVICE_TOKEN` — the controller resolves each shipment's
 * `orderId → Order.customerId` for the customer column (#770). Registers the
 * shipment controller plus the pickup-point controller (#766) — the latter
 * resolves `PICKUP_POINT_LOOKUP_SERVICE_TOKEN` from the core `ShippingModule`.
 * Mirrors `MappingsApiModule`.
 *
 * `FulfillmentModule` (pack-bench completion) is imported so `GET :id/label` can resolve
 * `FULFILLMENT_VERIFICATION_SERVICE_TOKEN` and best-effort stamp
 * `labelPrintedAt` on a shipment's linked work object — see the controller's
 * own docblock. `libs/core/src/fulfillment` stays a zero-sibling-edge leaf:
 * this is an APP-layer composition edge, not a core-to-core one.
 *
 * @module apps/api/src/shipping
 */
import { Module } from '@nestjs/common';
import { FulfillmentModule } from '@openlinker/core/fulfillment';
import { ShippingModule } from '@openlinker/core/shipping';
import { OrdersModule } from '@openlinker/core/orders';

import { ShipmentController } from './http/shipment.controller';
import { PickupPointController } from './http/pickup-point.controller';

@Module({
  imports: [ShippingModule, OrdersModule, FulfillmentModule],
  controllers: [ShipmentController, PickupPointController],
})
export class ShippingApiModule {}
