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
import { ShippingModule } from '@openlinker/core/shipping';

import { FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN } from './application/interfaces/fulfillment-parcel-closure-notifier.service.interface';
import { FulfillmentParcelClosureNotifierService } from './application/services/fulfillment-parcel-closure-notifier.service';
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
  //   ShippingModule  (#3292, #3525) — the shipment(s) dispatched for one work,
  //                             via `IShipmentQueryService.findByFulfillmentWorkIds`,
  //                             and the shipment-first dispatch router (#3506) the
  //                             closure notifier hands every `dispatch` intent to;
  //                             the worker's relay sweep uses the same one
  //
  // All are reached through their published `I*Service` interfaces and never
  // a `*RepositoryPort`, and every page-shaped read is batched per page.
  imports: [CoreFulfillmentModule, OrdersModule, InventoryModule, ProductsModule, ShippingModule],
  controllers: [FulfillmentWorkController],
  providers: [
    FulfillmentParcelClosureNotifierService,
    {
      provide: FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN,
      useExisting: FulfillmentParcelClosureNotifierService,
    },
  ],
  // Exported so `BenchApiModule` — the bench's automatic close, the OTHER
  // half of #3525 — can reach the SAME notifier rather than a copy.
  exports: [FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN],
})
export class FulfillmentApiModule {}
