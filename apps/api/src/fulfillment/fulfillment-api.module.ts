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
import { InventoryModule } from '@openlinker/core/inventory';
import { OrdersModule } from '@openlinker/core/orders';
import { ProductsModule } from '@openlinker/core/products';

import { FulfillmentWorkController } from './http/fulfillment-work.controller';

@Module({
  // Every cross-context join this board needs happens HERE, never inside
  // CoreFulfillmentModule, which is a registered zero-sibling-edge leaf
  // (ADR-053) forbidden from reading any of the three:
  //
  //   OrdersModule    (#3425) — masked buyer name, dispatch deadline, carrier,
  //                             and the source's own order reference (#3426)
  //   InventoryModule (#3426) — the location's operator-authored name
  //   ProductsModule  (#3426) — each line's product name
  //
  // All three are reached through their published `I*Service` interfaces and
  // never a `*RepositoryPort`, and all three reads are batched per page.
  imports: [CoreFulfillmentModule, OrdersModule, InventoryModule, ProductsModule],
  controllers: [FulfillmentWorkController],
})
export class FulfillmentApiModule {}
