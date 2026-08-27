/**
 * Order Holds Module (#2338, DESIGN §6.3)
 *
 * A **leaf** module inside the `orders` context: it imports nothing but its own
 * `TypeOrmModule.forFeature`, and it is what a consumer imports to reach the
 * hold record.
 *
 * ## Why this is not simply part of `OrdersModule`
 *
 * `OrdersModule` imports Integrations, IdentifierMapping, Sync, Products,
 * Mappings, Customers, Invoicing and Currency. #2339's `OrderHoldService` — provided
 * HERE — needs one repository from this context; making it import that graph would couple the
 * hold seam to eight siblings it has no business knowing. The precedent is
 * `OrderChangesModule` one file over, and behind it
 * `@openlinker/core/listings/services`: one context, more than one module, split
 * so a consumer takes only the seam it needs.
 *
 * ## Who imports it
 *
 * `OrdersModule` imports it (and re-exports the token), so the repository is
 * reachable from the app graph today — which is also what lets
 * `order-holds.int-spec.ts` resolve it, since `apps/**` may not deep-import
 * `@openlinker/core/*` sub-paths to reach the class directly.
 *
 * That edge is DIRECTIONAL and costs this module nothing: importing a leaf into
 * a fat module does not give the leaf the fat module's dependencies. #2339's
 * `OrderHoldService` therefore lives HERE rather than in `OrdersModule`, which
 * is what keeps the narrow seam the split exists for — and its own dependency
 * list (one repository, a logger, a type-only vocabulary import) is what makes
 * that placement honest rather than nominal.
 *
 * @module libs/core/src/orders
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncModule } from '@openlinker/core/sync';
import { OrderHoldOrmEntity } from './infrastructure/persistence/entities/order-hold.orm-entity';
import { OrderRecordOrmEntity } from './infrastructure/persistence/entities/order-record.orm-entity';
import { OrderHoldRepository } from './infrastructure/persistence/repositories/order-hold.repository';
import { OrderHoldProjectionRepository } from './infrastructure/persistence/repositories/order-hold-projection.repository';
import { OrderHoldService } from './application/services/order-hold.service';
import { OrderHoldProjectionReconcileService } from './application/services/order-hold-projection-reconcile.service';
import {
  ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
  ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN,
  ORDER_HOLD_REPOSITORY_TOKEN,
  ORDER_HOLD_SERVICE_TOKEN,
} from './orders.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderHoldOrmEntity, OrderRecordOrmEntity]),
    // #2338 review — `OrderHoldService` probes the per-order dispatch lock so a
    // hold placed over an in-flight carrier call is REPORTED rather than silent.
    // `SyncModule` is itself a leaf (one `TypeOrmModule.forFeature`, no sibling
    // context), so the narrow-seam property this split exists for survives: the
    // hold module still pulls in nothing resembling `OrdersModule`'s graph.
    SyncModule,
  ],
  providers: [
    OrderHoldRepository,
    { provide: ORDER_HOLD_REPOSITORY_TOKEN, useExisting: OrderHoldRepository },
    // #2339 — the service lives HERE rather than in `OrdersModule`, so the
    // narrow seam this split exists for is what the service actually takes.
    OrderHoldService,
    { provide: ORDER_HOLD_SERVICE_TOKEN, useExisting: OrderHoldService },
    // #2340 — the projection cache. A SECOND repository over a second table in
    // the same context; see `OrderHoldService`'s docblock for why that is a
    // deliberate end to the module's "one repository" posture rather than drift.
    OrderHoldProjectionRepository,
    {
      provide: ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN,
      useExisting: OrderHoldProjectionRepository,
    },
    OrderHoldProjectionReconcileService,
    {
      provide: ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
      useExisting: OrderHoldProjectionReconcileService,
    },
  ],
  exports: [
    ORDER_HOLD_REPOSITORY_TOKEN,
    ORDER_HOLD_SERVICE_TOKEN,
    ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
  ],
})
export class OrderHoldsModule {}
