/**
 * Fulfillment API Module (#2406)
 *
 * REST surface for the operator worklist. Composition-only over the core
 * `FulfillmentModule`, the `CatalogTrustApiModule` shape.
 *
 * Named `FulfillmentApiModule`, never `FulfillmentModule` — that name is the
 * core context's own barrel export, and two classes under one name in the same
 * import graph is a trap for the next reader.
 *
 * @module apps/api/src/fulfillment
 */
import { Module } from '@nestjs/common';
import { FulfillmentModule as CoreFulfillmentModule } from '@openlinker/core/fulfillment';
import { OrdersModule } from '@openlinker/core/orders';

import { FulfillmentWorkController } from './http/fulfillment-work.controller';

@Module({
  // OrdersModule (#3425, epic #3401): the order join — masked buyer name,
  // dispatch deadline, carrier — happens HERE, never inside
  // CoreFulfillmentModule, which is a registered zero-sibling-edge leaf
  // (ADR-053) forbidden from reading `orders`.
  imports: [CoreFulfillmentModule, OrdersModule],
  controllers: [FulfillmentWorkController],
})
export class FulfillmentApiModule {}
