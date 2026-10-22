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
import { IdentifierMappingModule as CoreIdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { InventoryModule } from '@openlinker/core/inventory';
import { MappingsModule as CoreMappingsModule } from '@openlinker/core/mappings';
import { OrdersModule } from '@openlinker/core/orders';
import { ProductsModule } from '@openlinker/core/products';
import { ShippingModule } from '@openlinker/core/shipping';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';

import { AUTO_DISPATCH_READ_SERVICE_TOKEN } from './application/interfaces/auto-dispatch-read.service.interface';
import { FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN } from './application/interfaces/fulfillment-parcel-closure-notifier.service.interface';
import {
  AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN,
  AutoDispatchPlanContextLoader,
} from './application/services/auto-dispatch-plan-context.loader';
import { AutoDispatchReadService } from './application/services/auto-dispatch-read.service';
import { FulfillmentParcelClosureNotifierService } from './application/services/fulfillment-parcel-closure-notifier.service';
import { AutoDispatchController } from './http/auto-dispatch.controller';
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
  //   IntegrationsModule + SyncModule (#2729) — the closure notifier reads the
  //   holder's `autoDispatch.trigger` and enqueues the label job on close.
  //   MappingsModule + IdentifierMappingModule (#2729) — the routing rule's
  //   parcel profile and the connection read behind the auto-dispatch refusal
  //   list and preview.
  imports: [
    CoreFulfillmentModule,
    OrdersModule,
    InventoryModule,
    ProductsModule,
    ShippingModule,
    CoreIntegrationsModule,
    CoreSyncModule,
    CoreMappingsModule,
    CoreIdentifierMappingModule,
  ],
  controllers: [FulfillmentWorkController, AutoDispatchController],
  providers: [
    FulfillmentParcelClosureNotifierService,
    {
      provide: FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN,
      useExisting: FulfillmentParcelClosureNotifierService,
    },
    AutoDispatchPlanContextLoader,
    {
      provide: AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN,
      useExisting: AutoDispatchPlanContextLoader,
    },
    AutoDispatchReadService,
    { provide: AUTO_DISPATCH_READ_SERVICE_TOKEN, useExisting: AutoDispatchReadService },
  ],
  // Exported so `BenchApiModule` — the bench's automatic close, the OTHER
  // half of #3525 — can reach the SAME notifier rather than a copy, and so the
  // bench's own label route (#2729, D46) feeds the same decision the preview
  // and the worker make.
  exports: [FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN, AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN],
})
export class FulfillmentApiModule {}
