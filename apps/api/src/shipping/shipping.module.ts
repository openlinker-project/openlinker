/**
 * Shipping API Module
 *
 * Wires the shipment HTTP layer (#846). Imports the core `ShippingModule` for
 * the query / dispatch / cancellation service bindings (and the underlying
 * `ShipmentRepositoryPort` + dispatch seam from #763/#835) and registers the
 * shipment controller. Mirrors `MappingsApiModule`.
 *
 * @module apps/api/src/shipping
 */
import { Module } from '@nestjs/common';
import { ShippingModule } from '@openlinker/core/shipping';

import { ShipmentController } from './http/shipment.controller';

@Module({
  imports: [ShippingModule],
  controllers: [ShipmentController],
})
export class ShippingApiModule {}
